// Initialises Swagger UI for the Car Rental external API reference.
// Kept as a separate file (not inline) so /api/docs can be served under a
// strict Content-Security-Policy with `script-src 'self'`.
window.ui = SwaggerUIBundle({
  url: "/api/openapi.json",
  dom_id: "#swagger-ui",
  deepLinking: true,
  persistAuthorization: true,
  tryItOutEnabled: true,
  defaultModelsExpandDepth: 0,
});
