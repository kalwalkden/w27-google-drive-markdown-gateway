locals {
  oauth_secret_references = var.drive_auth_mode == "my-drive-refresh-token" ? {
    oauth = {
      id      = var.oauth_secret_id
      version = var.oauth_secret_version
    }
  } : {}
}

resource "google_secret_manager_secret_iam_member" "codex_bearer" {
  project   = var.project_id
  secret_id = var.codex_bearer_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "oauth" {
  for_each = local.oauth_secret_references

  project   = var.project_id
  secret_id = each.value.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
