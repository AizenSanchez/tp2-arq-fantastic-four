# Storage del servicio: Azure Managed Redis (PaaS). Reemplaza al Redis del docker-compose del TP1.

# El hostname del cluster es <name>.<region>.redis.azure.net, asi que el nombre tiene que ser unico
resource "random_string" "redis_name" {
  length  = 12
  lower   = true
  upper   = false
  special = false
  numeric = false
}

resource "azurerm_managed_redis" "redis" {
  name                = "arvault${random_string.redis_name.result}"
  resource_group_name = azurerm_resource_group.tp2_resource_group.name
  location            = azurerm_resource_group.tp2_resource_group.location
  sku_name            = var.redis_sku

  high_availability_enabled = var.redis_high_availability

  default_database {
    # Por defecto esta en false y el recurso no exporta ninguna clave: la app no podria autenticarse
    access_keys_authentication_enabled = true

    # TLS en el puerto 10000 (el cliente usa rediss://)
    client_protocol = "Encrypted"

    # Por defecto es OSSCluster, que exige un cliente cluster-aware. EnterpriseCluster deja usar un cliente comun,
    # pero NO alcanza para los scripts del TP1: con esta politica solo DEL, MSET, MGET, EXISTS, UNLINK y TOUCH
    # pueden usar claves de slots distintos. Por eso todas las claves de la app llevan el hash tag {av}:
    # (node/keys.js), asi MULTI y los scripts Lua con varias claves caen en un mismo slot
    clustering_policy = "EnterpriseCluster"

    # Mismo criterio que el TP1 (volatile-ttl): si falta memoria solo se descartan las claves con TTL,
    # que son las de idempotencia. El log y los saldos no tienen TTL y no se pierden
    eviction_policy = "VolatileTTL"
  }
}
