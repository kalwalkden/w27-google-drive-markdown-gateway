output "service_name" {
  value       = google_cloud_run_v2_service.gateway.name
  description = "Cloud Run service name."
}

output "region" {
  value       = google_cloud_run_v2_service.gateway.location
  description = "Cloud Run service region."
}

output "artifact_registry_repository" {
  value       = google_artifact_registry_repository.gateway.repository_id
  description = "Artifact Registry repository ID."
}

output "service_uri" {
  value       = google_cloud_run_v2_service.gateway.uri
  description = "Cloud Run service URI."
}
