package com.boqlet.api.mail;

import com.boqlet.api.db.StoredJson;
import com.boqlet.api.extension.CoreModules;
import com.boqlet.api.identity.LinkTokens;
import com.boqlet.api.org.Invitations;
import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

@Component
class EmailDelivery {
    private static final Logger LOG = LoggerFactory.getLogger(EmailDelivery.class);
    private final JdbcTemplate database;
    private final StoredJson json;
    private final ObjectProvider<JavaMailSender> sender;
    private final Invitations invitations;
    private final LinkTokens links;
    private final CoreModules modules;
    private final TransactionTemplate transactions;
    private final String app;
    private final String from;

    EmailDelivery(JdbcTemplate database, StoredJson json, ObjectProvider<JavaMailSender> sender, Invitations invitations, LinkTokens links,
                  CoreModules modules, TransactionTemplate transactions, @Value("${BOQLET_APP_URL:http://localhost:3000}") String app,
                  @Value("${BOQLET_SMTP_FROM:}") String from) {
        this.database = database;
        this.json = json;
        this.sender = sender;
        this.invitations = invitations;
        this.links = links;
        this.modules = modules;
        this.transactions = transactions;
        this.app = app.replaceAll("/+$", "");
        this.from = from;
    }

    @Scheduled(fixedDelayString = "${BOQLET_SMTP_POLL_MS:3000}")
    void poll() {
        if (from.isBlank()) return;
        JavaMailSender mail = sender.getIfAvailable();
        if (mail == null) return;
        for (int count = 0; count < 10; count++) {
            if (!Boolean.TRUE.equals(transactions.execute(status -> sendNext(mail)))) break;
        }
    }

    private boolean sendNext(JavaMailSender mail) {
        var next = database.query("""
                SELECT id, org_id, kind, entity_id, recipient, payload::text, attempts
                FROM email_outbox WHERE sent_at IS NULL AND canceled_at IS NULL AND next_attempt_at <= now()
                ORDER BY next_attempt_at, id LIMIT 1 FOR NO KEY UPDATE SKIP LOCKED
                """, (row, index) -> new Item(row.getObject("id", UUID.class), row.getObject("org_id", UUID.class),
                    row.getString("kind"), row.getObject("entity_id", UUID.class), row.getString("recipient"),
                    json.read(row.getString("payload"), JsonNode.class), row.getInt("attempts")))
                .stream().findFirst();
        if (next.isEmpty()) return false;
        var item = next.get();
        try {
            var text = switch (item.kind()) {
                case "invitation" -> invitation(item);
                case "notification" -> notification(item);
                case "org_deleted" -> deletedOrganisation(item);
                case "account_link" -> accountLink(item);
                case "account_exists" -> accountExists(item);
                default -> null;
            };
            if (text == null) {
                database.update("UPDATE email_outbox SET canceled_at = now() WHERE id = ?", item.id());
                return true;
            }
            var message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(item.email());
            message.setSubject(text.subject());
            message.setText(text.body());
            mail.send(message);
            database.update("UPDATE email_outbox SET sent_at = now(), attempts = attempts + 1 WHERE id = ?", item.id());
        } catch (MailException | IllegalArgumentException failure) {
            int attempts = item.attempts() + 1;
            long delaySeconds = Math.min(3600, 30L << Math.min(attempts - 1, 7));
            database.update("""
                    UPDATE email_outbox SET attempts = ?, next_attempt_at = now() + (? * interval '1 second'),
                        canceled_at = CASE WHEN ? >= 8 THEN now() END WHERE id = ?
                    """, attempts, delaySeconds, attempts, item.id());
            LOG.warn("Email outbox item {} failed on attempt {} ({})", item.id(), attempts, failure.getClass().getSimpleName());
        }
        return true;
    }

    private Text invitation(Item item) {
        UUID nonce = UUID.fromString(item.payload().path("nonce").asText());
        return database.query("""
                SELECT o.name, i.expires_at, o.settings->>'defaultLanguage' AS locale FROM org_invitations i
                JOIN orgs o ON o.id = i.org_id AND o.status = 'active'
                WHERE i.id = ? AND i.org_id = ? AND i.delivery_nonce = ? AND i.email = ?
                  AND i.status = 'pending' AND i.expires_at > now()
                """, (row, index) -> {
                    String name = row.getString("name");
                    String expiry = row.getObject("expires_at", OffsetDateTime.class).format(DateTimeFormatter.ISO_LOCAL_DATE);
                    String link = app + "/invite/" + invitations.deliveryToken(item.entity(), nonce);
                    if (serbian(row.getString("locale"))) return new Text("Poziv za pristup organizaciji na boqlet-u",
                            "Pozvani ste da se pridružite organizaciji " + name + ".\n\nPrihvatite poziv: " + link
                            + "\n\nPoziv važi do " + expiry + ".");
                    return new Text("Invitation to join an organisation on boqlet",
                            "You've been invited to join " + name + ".\n\nAccept the invitation: " + link
                            + "\n\nThe invitation expires on " + expiry + ".");
                }, item.entity(), item.org(), nonce, item.email()).stream().findFirst().orElse(null);
    }

    /**
     * A sign-up or reset link (P57), while it is still the address's current link: a newer request,
     * a used link or an expired one sends nothing. The token is derived again from the nonce.
     */
    private Text accountLink(Item item) {
        boolean sr = serbian(item.payload().path("locale").asText(""));
        return database.query("""
                SELECT purpose FROM native_setup_links WHERE email = ? AND nonce = ? AND expires_at > now()
                """, (row, index) -> {
                    boolean reset = row.getString(1).equals("reset");
                    String link = app + "/sign-up?token=" + links.token(item.entity()) + (reset ? "&reset=1" : "");
                    if (reset) return sr
                            ? new Text("Nova lozinka | boqlet", "Izaberite novu lozinku: " + link + "\n\nLink važi jedan sat. "
                                    + "Nova lozinka vas odjavljuje sa uređaja na kome ste prijavljeni.\n\n"
                                    + "Ako niste vi tražili promenu, zanemarite ovu poruku: lozinka ostaje ista.")
                            : new Text("Reset your password | boqlet", "Choose a new password: " + link + "\n\nThe link works for one hour. "
                                    + "Setting a new password signs your account out where it is signed in.\n\n"
                                    + "If you didn't ask for this, ignore this email: your password stays as it is.");
                    return sr
                            ? new Text("Napravite nalog | boqlet", "Postavite lozinku i napravite nalog na boqlet-u: " + link
                                    + "\n\nLink važi jedan sat. Ako niste tražili nalog, zanemarite ovu poruku.")
                            : new Text("Create your account | boqlet", "Set a password to create your boqlet account: " + link
                                    + "\n\nThe link works for one hour. If you didn't ask for an account, ignore this email.");
                }, item.email(), item.entity()).stream().findFirst().orElse(null);
    }

    /** Someone asked to sign up with an address that has an account (P57): say so, never with a token. */
    private Text accountExists(Item item) {
        if (serbian(item.payload().path("locale").asText(""))) return new Text("Već imate nalog | boqlet",
                "Neko je zatražio novi nalog na boqlet-u sa ovom adresom, a ona već ima nalog.\n\nPrijava: " + app + "/sign-in"
                + "\nZaboravljena lozinka: " + app + "/reset-password\n\nAko to niste bili vi, zanemarite ovu poruku.");
        return new Text("You already have an account | boqlet",
                "Someone asked to create a boqlet account with this address, and it already has one.\n\nSign in: " + app + "/sign-in"
                + "\nForgot your password? " + app + "/reset-password\n\nIf this wasn't you, ignore this email.");
    }

    private Text notification(Item item) {
        String category = item.payload().path("category").asText();
        String url = item.payload().path("url").asText();
        if (!url.startsWith("/") || url.startsWith("//") || url.contains("\\") || URI.create(url).isAbsolute()) return null;
        return database.query("""
                SELECT u.locale FROM notifications n JOIN users u ON u.id = n.user_id
                JOIN orgs o ON o.id = n.org_id AND o.status = 'active'
                JOIN memberships m ON m.org_id = n.org_id AND m.user_id = n.user_id
                LEFT JOIN project_members p ON p.org_id = m.org_id AND p.user_id = m.user_id AND p.project_id = n.project_id
                WHERE n.id = ? AND n.org_id = ? AND u.deleted_at IS NULL AND u.email = ?
                  AND coalesce((u.notification_preferences->>?)::boolean, true)
                  AND (n.project_id IS NULL OR m.role IN ('owner','admin') OR p.user_id IS NOT NULL)
                """, (row, index) -> notificationText(item.payload(), url, row.getString(1)),
                item.entity(), item.org(), item.email(), category).stream().findFirst().orElse(null);
    }

    private Text deletedOrganisation(Item item) {
        return database.query("""
                SELECT o.name, u.locale FROM orgs o JOIN memberships m ON m.org_id = o.id
                JOIN users u ON u.id = m.user_id WHERE o.id = ? AND o.status = 'deleting' AND u.email = ? AND u.deleted_at IS NULL
                """, (row, index) -> serbian(row.getString("locale"))
                    ? new Text("Organizacija se briše | boqlet", "Zatraženo je brisanje organizacije " + row.getString("name") + ".")
                    : new Text("Organisation being deleted | boqlet", "Deletion was requested for " + row.getString("name") + "."),
                item.org(), item.email()).stream().findFirst().orElse(null);
    }

    private Text notificationText(JsonNode data, String url, String locale) {
        String kind = data.path("kind").asText();
        boolean sr = serbian(locale);
        var template = modules.emailTemplates().get(kind);
        if (template != null) {
            var rendered = template.render().apply(locale, data.path("params"));
            return withLinks(rendered.subject(), rendered.body(), url, sr);
        }
        String subject = switch (kind) {
            case "job.failed" -> sr ? "Obrada nije uspela" : "Processing failed";
            case "model_version.ready" -> sr ? "Model je spreman" : "Your model is ready";
            case "boq.confirmed" -> sr ? "Predmer je potvrđen" : "A BoQ was confirmed";
            case "boq.reopened" -> sr ? "Predmer je ponovo otvoren" : "A BoQ was reopened";
            case "revision.review_requested" -> sr ? "Predmer čeka vaš pregled" : "A BoQ is ready for your review";
            case "revision.changes_requested" -> sr ? "Zatražene su izmene predmera" : "Changes were requested on a BoQ";
            case "revision.approved" -> sr ? "Predmer je odobren" : "A BoQ was approved";
            case "project_member.added" -> sr ? "Dodati ste na projekat" : "You were added to a project";
            case "limit.near" -> sr ? "Približavate se ograničenju plana" : "You're approaching a plan limit";
            case "limit.reached" -> sr ? "Dostignuto je ograničenje plana" : "A plan limit was reached";
            default -> sr ? "Imate novo obaveštenje" : "You have a new notification";
        };
        return withLinks(subject, subject + ".", url, sr);
    }

    private Text withLinks(String subject, String body, String url, boolean sr) {
        return new Text(subject + " | boqlet", body + "\n\n" + (sr ? "Otvori u boqlet-u: " : "Open in boqlet: ")
                + app + url + "\n\n" + (sr ? "Podešavanja e-pošte: " : "Email preferences: ") + app + "/account");
    }

    private static boolean serbian(String locale) {
        return locale != null && Locale.forLanguageTag(locale).getLanguage().equals("sr");
    }

    private record Item(UUID id, UUID org, String kind, UUID entity, String email, JsonNode payload, int attempts) {}
    private record Text(String subject, String body) {}
}
