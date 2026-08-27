FROM node:20-alpine AS frontend-build
WORKDIR /frontend
COPY app/frontend/package.json app/frontend/package-lock.json ./
RUN npm ci
RUN npm install --no-save openseadragon@5.0.1
COPY app/frontend/ ./
RUN npm run build

FROM maven:3.9.9-eclipse-temurin-22 AS backend-build
WORKDIR /backend
RUN apt-get update && apt-get install -y openslide-tools && rm -rf /var/lib/apt/lists/*
RUN apt-get update && apt-get install -y openssl && \
    openssl s_client -showcerts -connect artifacts.unidata.ucar.edu:443 </dev/null 2>/dev/null | \
    sed -ne '/-BEGIN CERTIFICATE-/,/-END CERTIFICATE-/p' > /tmp/unidata.crt && \
    keytool -import -trustcacerts -keystore $JAVA_HOME/lib/security/cacerts \
            -storepass changeit -noprompt -alias unidata -file /tmp/unidata.crt
COPY app/backend/pom.xml ./
RUN mvn dependency:go-offline
COPY app/backend/src ./src
RUN mvn clean package -DskipTests

FROM eclipse-temurin:22-jre
WORKDIR /app
RUN apt-get update \
    && apt-get install -y nginx openslide-tools curl \
    && rm -rf /var/lib/apt/lists/* \
    && rm -f /etc/nginx/sites-enabled/default
COPY --from=backend-build /backend/target/*.jar /app/app.jar
COPY --from=frontend-build /frontend/dist /usr/share/nginx/html
COPY app/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY app/docker/start-app.sh /app/start-app.sh
RUN chmod +x /app/start-app.sh \
    && mkdir -p /app/slides /app/inbox
EXPOSE 80
ENTRYPOINT ["/app/start-app.sh"]
