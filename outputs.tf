output "vmss_instances" {
  value = azurerm_linux_virtual_machine_scale_set.tp2_vmss.instances
}

output "vmss_sku" {
  value = azurerm_linux_virtual_machine_scale_set.tp2_vmss.sku
}

output "redis_sku" {
  value = azurerm_managed_redis.redis.sku_name
}
