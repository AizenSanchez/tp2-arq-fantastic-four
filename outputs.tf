# Sirven de evidencia de como estaba desplegada cada configuracion (terraform output).
# Ninguno incluye claves.

output "lb_fqdn" {
  value = azurerm_public_ip.lb_public_ip.fqdn
}

output "vmss_instances" {
  value = azurerm_linux_virtual_machine_scale_set.tp2_vmss.instances
}

output "vmss_sku" {
  value = azurerm_linux_virtual_machine_scale_set.tp2_vmss.sku
}

output "arca_ip" {
  value = azurerm_container_group.tp2_container.ip_address
}

output "redis_hostname" {
  value = azurerm_managed_redis.redis.hostname
}

output "redis_port" {
  value = azurerm_managed_redis.redis.default_database[0].port
}

output "redis_sku" {
  value = azurerm_managed_redis.redis.sku_name
}
