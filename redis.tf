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

  high_availability_enabled = false

  default_database {
    # por defecto es false y entonces Azure no exporta primary_access_key
    access_keys_authentication_enabled = true

    # sin shards: MULTI y Lua pueden tocar varias claves sin que tengan que caer en el mismo slot
    clustering_policy = "NoCluster"

    eviction_policy = "VolatileTTL"
  }
}
