resource "google_service_account" "runtime" {
  account_id   = var.runtime_service_account_id
  display_name = "Google Drive Markdown Gateway runtime"
}
