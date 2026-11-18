# Puesta en marcha para medir en Azure (cada uno en su cuenta)

Cada integrante despliega **su propia infraestructura** en **su propia cuenta de Azure** y mide ahí su bloque. Esto es lo que hay que tener
listo, en orden. Lo marcado con 👤 lo tiene que hacer la persona (cuentas, secretos, aceptar términos); lo marcado con 🤖 lo puede hacer Claude Code.

> **Nunca** pegar claves, tokens ni el contenido de `terraform.tfvars` o `key.pem` en un chat, un commit o un screenshot.
> `.gitignore` ya excluye `terraform.tfvars`, `key.pem`, `node/infra.json`, `*.tfstate` y `ansible/ddog_api_key`.

## 1. Herramientas

| Herramienta | Para qué | Cómo comprobarla |
|---|---|---|
| `az` (Azure CLI) | iniciar sesión, registrar providers, leer métricas | `az --version` |
| `terraform` ≥ 1.3 | crear la infraestructura | `terraform version` |
| `ansible` + colección `datadog.dd` | instalar Node y el agente de Datadog en los nodos, desplegar la app | `ansible --version` y `ansible-galaxy collection list \| grep datadog` |
| `docker` | ensayo local y control negativo | `docker --version` |
| `node` 22 o más, `npm`, `zip`, `jq`, `curl` | scripts de medición | `node --version` |

En esta máquina ya están instalados Terraform 1.13.5 y Ansible 2.22 con `datadog.dd` 6.5.0 (en `~/.local/bin`, sin tocar el sistema). Y `perf/` necesita `cd perf && npm ci`.

## 2. Cuentas y secretos (👤)

1. **Cuenta de Azure.** Sirve una cuenta gratuita con crédito de prueba (US$ 200) o Azure for Students. En la gratuita, Azure no cobra durante la prueba: los servicios se pausan al terminar o al agotarse el crédito. **Nunca apretar *Upgrade to pay-as-you-go***: es lo único que la convierte en cuenta de pago. Después:
   ```bash
   az login                                   # abre el navegador
   az account show --query '{estado:state, nombre:name}' -o table
   az account show --query id -o tsv          # este es azure_sid (no es un secreto, pero tampoco se publica)
   az provider register --namespace Microsoft.Cache
   az provider register --namespace Microsoft.ContainerInstance
   az vm list-usage --location eastus2 -o table | grep -iE "Total Regional|Falsv7"   # hacen falta 3 vCPU (jumpbox + 2 nodos); una cuenta gratuita suele tener 4 por region
   ```
2. **Par de claves SSH** (se puede hacer por terminal, sin que la privada se muestre nunca: `ssh-keygen -t rsa -b 4096 -m PEM -N "" -f key.pem`, y registrar solo la pública con `az group create -n keys -l eastus2` y `az sshkey create -g keys -n ssh_key --public-key @key.pem.pub`). Equivale a hacerlo en el portal: crear el grupo de recursos `keys` y dentro un recurso *SSH key* llamado `ssh_key` (*Generate new key pair*).
   Se descarga la clave privada **una sola vez**: guardarla como `key.pem` en la raíz del repo y `chmod 400 key.pem`.
3. **Docker Hub**: cuenta gratuita y un token *Public Repo Read-only* (Account settings → Personal access tokens). Azure lo usa para bajar `arqsoft/arca:1.0.0`.
4. **Datadog**: cuenta (pack de estudiante de GitHub o prueba de 14 días) y una **API key** (Organization Settings → API Keys). Anotar el *sitio*
   (el host que ves en el navegador: `app.datadoghq.com`, `us5.datadoghq.com`...). Opcional, para bajar series automáticamente: una *Application key*.
5. **`terraform.tfvars`** en la raíz del repo, escrito por la persona:
   ```properties
   azure_sid          = "<id de suscripcion>"
   machine_sku        = "Standard_F1als_v7"   # ver el punto 3
   datadog_key        = "<API key de Datadog>"
   dockerhub_username = "<usuario>"
   dockerhub_token    = "<token>"
   ```

## 3. Ajustes que dependen de tu cuenta

- **Sitio de Datadog.** `ansible/vmss_setup.yml` tiene `datadog_site: "us5.datadoghq.com"`. Si tu cuenta es de otro sitio, cambialo **solo en tu copia** (no commitear) y exportá el mismo
  valor para Artillery: `export DATADOG_API_HOST=<tu sitio>`.
- **Tamaño de las VMs (`machine_sku`).** El repo trae `Standard_B1s`, pero **en `eastus2` no está disponible para todas las suscripciones** (no aparece en algunas suscripciones; el resto del grupo midió con `Standard_F1als_v7`). Comprobarlo antes de desplegar: `az vm list-skus -l eastus2 --size Standard_B1s --resource-type virtualMachines -o table` (tarda un minuto; si no devuelve nada, no está). Se cambia en `terraform.tfvars` sin tocar código. Usar el mismo SKU que el resto del grupo hace comparables las mediciones. Cuesta ≈ US$ 0,06 por hora por VM (la B1s, 0,01): el despliegue completo con 2 nodos ronda US$ 0,26 por hora.
- **Región.** El default es `eastus2`. Si `Standard_B1s` o Azure Managed Redis no están disponibles en tu suscripción, usar `westus2`: `-var region=westus2` en cada `terraform plan` / `apply`.

## 4. Rama de medición (🤖)

El caso de 2 nodos necesita la variable `node_instances`, que hoy no está en `main` (Aizen la tiene en su rama `perf/bloque3-disponibilidad`, con otro valor por defecto en un commit aparte). Para no chocar con su PR, **no** se agrega al nuestro: se arma una rama local de medición.

```bash
git checkout -b medicion/bloque4 perf/integridad
git cherry-pick aeab8f6            # solo "make the number of vmss instances a variable" (default 1)
```

Los resultados de Azure se commitean en `perf/integridad` (el PR); `meta.txt` registra el commit desde el que se desplegó.

## 5. Despliegue (👤 aprueba, 🤖 ejecuta)

**No usar `./start.sh`**: hace `az login` y `terraform apply -auto-approve`. Siempre plan y después apply:

```bash
terraform init
terraform plan -out tfplan         # revisar: solo debe CREAR recursos, ninguno "replaced"
terraform apply tfplan             # unos 15 a 45 min: Redis es lo que más tarda
ansible/setup.sh                   # agente de Datadog, Node 24 y pm2 en cada nodo
ansible/deploy.sh                  # empaqueta node/ (exige node/infra.json) y lo instala
```

Verificación mínima:

```bash
curl http://$(cat node/lb_dns)/               # "Server is up."
curl http://$(cat node/lb_dns)/health         # {"status":"ok"} (prueba Redis con TLS y clave)
curl -s -X POST http://$(cat node/lb_dns)/exchange -H 'content-type: application/json' \
  -d '{"baseCurrency":"ARS","counterCurrency":"USD","baseAmount":1000,"baseAccountId":101,"counterAccountId":102,"dni":"40101235"}'   # 200, 403 o 503
cd ansible && ansible -i vmss_hosts all -u azureuser --private-key ../key.pem -m shell -a "pm2 ls"
```

## 6. Antes de medir

1. **Las predicciones tienen que estar pusheadas.** Están en `perf/predicciones/integridad.md`, commits `d868f13`, `574ced2` y `7278141`, en la rama `perf/integridad` de `origin`.
2. **Prueba corta con la clave real de Datadog** (un caso `prueba-seca`, que no se commitea) y mirar que lleguen las métricas al dashboard. Sin `DEBUG` prendido.
3. **Un escenario a la vez.** En tu propia cuenta ya no se pisan los demás bloques, pero los escenarios cambian la tasa y el saldo de USD, y `correr.mjs` reinicia el estado antes de cada uno.

## 7. Corridas

```bash
read -s DATADOG_API_KEY; export DATADOG_API_KEY
export DATADOG_API_HOST=<tu sitio>   # si no es us5
export CONEXION=cable                # o wifi
node perf/integridad/correr.mjs saldo azure-1-nodo --env azure
node perf/integridad/correr.mjs reintentos azure-1-nodo --env azure
# opcionales: saldo-carga y duplicados
```

Para el caso escalado: `terraform apply -var node_instances=2` (con `plan -out` antes), después `ansible/setup.sh` y `ansible/deploy.sh` (con `upgrade_mode = "Automatic"` las instancias se reinician y pm2 no vuelve solo), comprobar `terraform output vmss_instances` y repetir con el caso `azure-2-nodos`.

## 8. Evidencia que hay que juntar por caso

- `perf/results/<caso>/` (lo genera `correr.mjs`): reporte crudo de Artillery, `pedidos.jsonl`, `rtt.json`, `informe.json`, `meta.txt`, `azure-monitor/`.
- `evidencia/<caso>/` (lo genera `capturar-infra.sh`): `terraform state list`, `terraform output`, `az vmss list-instances`.
- **Screenshots de Datadog** con el rango temporal de la corrida (que coincida con `inicio UTC` y `fin UTC` de `meta.txt`) y el **JSON del dashboard** exportado. Los hace una persona. Revisar que no muestren claves.
- Un extracto del log de la app con validaciones aprobadas y rechazadas: `ansible ... -m shell -a "pm2 logs app --lines 500 --nostream | grep arca_validacion"`.

## 9. Cierre

Cuando la evidencia esté commiteada y pusheada: `terraform destroy`, y eliminar el par de claves desde el portal de Azure. Revisar el crédito restante en *Cost Management* antes y durante.
