FROM node:18-alpine AS builder
WORKDIR /build

ARG PUBLIC_URL=/pacs-viewer
ENV PUBLIC_URL=$PUBLIC_URL

COPY app/package*.json ./
RUN npm install
RUN npm install cornerstone-core cornerstone-wado-image-loader dicom-parser dcmjs

COPY app/ ./
RUN cp node_modules/cornerstone-wado-image-loader/dist/index.worker.bundle.min.worker.js \
    public/cornerstoneWADOImageLoaderWebWorker.min.js
RUN npm run build

FROM nginx:alpine
COPY --from=builder /build/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
