FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /workspace
COPY packages/api/openapi.yaml packages/api/openapi.yaml
COPY packages/types/schema packages/types/schema
COPY services/api services/api
RUN mvn -B -ntp -f services/api/pom.xml -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/services/api/target/boqlet-api.jar /app/boqlet-api.jar
USER 10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/boqlet-api.jar"]
