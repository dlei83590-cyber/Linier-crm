export const openapi = {
  openapi: "3.1.0",
  info: { title: "Linier CRM Management System API", version: "0.1.0" },
  servers: [{ url: "/api/v1" }],
  paths: {
    "/health": {
      get: {
        summary: "Service health check",
        responses: { "200": { description: "Service is healthy" } },
      },
    },
    "/system/protected": {
      get: {
        summary: "JWT and RBAC framework verification endpoint",
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "Principal has system:read permission" },
          "401": { description: "Token is missing, invalid, or expired" },
          "403": { description: "Principal lacks permission" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },
  },
} as const;
