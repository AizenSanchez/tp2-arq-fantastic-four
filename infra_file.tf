# Datos de conexion para la app. Lo lee node/config.js y el zip lo lleva a los nodos.
# Tiene la clave de Redis: esta ignorado por git (node/infra.json en .gitignore) y no debe commitearse.
# La clave de Azure es base64 y puede tener "/" o "+", que rompen la URL si no se codifican.
resource "local_sensitive_file" "infra_json" {
  filename        = "${path.module}/node/infra.json"
  file_permission = "0600"
  content = jsonencode({
    arcaUri  = "http://${azurerm_container_group.tp2_container.ip_address}:8080"
    redisUrl = "rediss://:${urlencode(azurerm_managed_redis.redis.default_database[0].primary_access_key)}@${azurerm_managed_redis.redis.hostname}:${azurerm_managed_redis.redis.default_database[0].port}"
  })
}
