variable "azure_sid" {
  sensitive = true
}

variable "datadog_key" {
  sensitive = true
}

variable "dockerhub_username" {
  sensitive = true
}

variable "dockerhub_token" {
  sensitive = true
}

variable "region" {
  default = "eastus2"
}

variable "ssh_key_group_name" {
  default = "keys"
}

variable "ssh_key_name" {
  default = "ssh_key"
}

variable "os_publisher" {
  default = "Canonical"
}

variable "os_offer" {
  default = "ubuntu-24_04-lts"
}

variable "os_sku" {
  default = "server"
}

variable "os_version" {
  default = "latest"
}

variable "machine_sku" {
  default = "Standard_B1s"
}

variable "node_instances" {
  description = "Cantidad de nodos del VMSS (1 para el caso base, 2 para el escalado). Despues: ansible/setup.sh y ansible/deploy.sh"
  default     = 1
}

variable "redis_sku" {
  description = "SKU de Azure Managed Redis. Balanced_B0 es la mas chica; subirla si Redis aparece como cuello de botella"
  default     = "Balanced_B0"
}

variable "redis_high_availability" {
  description = "Replica de Redis para alta disponibilidad (duplica el costo). Cambiarlo recrea la instancia"
  default     = false
}
