package com.boqlet.api.http;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.regex.Pattern;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Caps the size of every request body that is not a multipart upload (TF-174, BE-D13): 1 MiB, or
 * 32 MiB for the operations that carry engine documents or batches. Larger bodies answer
 * `413 too_large` before anything parses them. A declared Content-Length is checked up front; a
 * body without one (chunked) is counted while it is read. Multipart uploads have their own limits
 * (`spring.servlet.multipart`, the plan's model size).
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 1)
final class RequestSizeFilter extends OncePerRequestFilter {
    static final long DEFAULT_LIMIT = 1L << 20;
    static final long DOCUMENT_LIMIT = 32L << 20;
    private static final Pattern DOCUMENTS = Pattern.compile("/api/v1/(presets/[^/]+/draft|presets/check|codelists/build"
            + "|model-versions/[^/]+/names|projects/[^/]+/decisions|boqs/[^/]+/overrides/batch)/?");

    private final ObjectMapper json;

    RequestSizeFilter(ObjectMapper json) {
        this.json = json;
    }

    static long limit(HttpServletRequest request) {
        return DOCUMENTS.matcher(RequestPaths.of(request)).matches() ? DOCUMENT_LIMIT : DEFAULT_LIMIT;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String type = request.getContentType();
        if (type != null && type.toLowerCase(java.util.Locale.ROOT).startsWith("multipart/")) {
            chain.doFilter(request, response);
            return;
        }
        long limit = limit(request);
        if (request.getContentLengthLong() > limit) {
            reject(response, limit);
            return;
        }
        chain.doFilter(new Limited(request, limit), response);
    }

    private void reject(HttpServletResponse response, long limit) throws IOException {
        response.setStatus(HttpServletResponse.SC_REQUEST_ENTITY_TOO_LARGE);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Connection", "close");
        json.writeValue(response.getOutputStream(), TooLarge.body(limit));
    }

    /** Thrown while reading a body that turns out larger than its limit; ApiErrors answers 413. */
    static final class TooLarge extends IOException {
        final long limit;

        TooLarge(long limit) {
            super("The request body exceeds " + (limit >> 20) + " MiB.");
            this.limit = limit;
        }

        static ApiError body(long limit) {
            return new ApiError("too_large", "The request body exceeds " + (limit >> 20) + " MiB.");
        }
    }

    private static final class Limited extends HttpServletRequestWrapper {
        private final long limit;
        private ServletInputStream stream;
        private BufferedReader reader;

        Limited(HttpServletRequest request, long limit) {
            super(request);
            this.limit = limit;
        }

        @Override
        public ServletInputStream getInputStream() throws IOException {
            if (stream == null) stream = new Counting(super.getInputStream(), limit);
            return stream;
        }

        @Override
        public BufferedReader getReader() throws IOException {
            if (reader == null) {
                String encoding = getCharacterEncoding();
                Charset charset = encoding == null ? StandardCharsets.UTF_8 : Charset.forName(encoding);
                reader = new BufferedReader(new InputStreamReader(getInputStream(), charset));
            }
            return reader;
        }
    }

    private static final class Counting extends ServletInputStream {
        private final ServletInputStream in;
        private final long limit;
        private long read;

        Counting(ServletInputStream in, long limit) {
            this.in = in;
            this.limit = limit;
        }

        @Override
        public int read() throws IOException {
            int b = in.read();
            if (b >= 0) count(1);
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            int n = in.read(buffer, offset, length);
            if (n > 0) count(n);
            return n;
        }

        private void count(int n) throws TooLarge {
            read += n;
            if (read > limit) throw new TooLarge(limit);
        }

        @Override
        public boolean isFinished() {
            return in.isFinished();
        }

        @Override
        public boolean isReady() {
            return in.isReady();
        }

        @Override
        public void setReadListener(ReadListener listener) {
            in.setReadListener(listener);
        }
    }
}
