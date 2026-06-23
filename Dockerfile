FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY generate_api_test_report.js ./generate_api_test_report.js
COPY generate_cross_surface_api_kpi_gap_report.js ./generate_cross_surface_api_kpi_gap_report.js

ENV NODE_ENV=production
EXPOSE 5001

CMD ["node", "src/server.js"]
