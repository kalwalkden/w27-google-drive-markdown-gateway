resource "google_artifact_registry_repository" "gateway" {
  location      = var.region
  repository_id = var.artifact_repository_id
  description   = "Container images for the Google Drive Markdown Gateway"
  format        = "DOCKER"
}
