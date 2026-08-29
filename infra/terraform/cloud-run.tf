locals {
  codex_secret_file = "${var.codex_secret_mount_path}/bearer"
  oauth_secret_file = "${var.oauth_secret_mount_path}/credentials.json"

  drive_config = var.drive_auth_mode == "shared-drive-adc" ? {
    authMode          = "shared-drive-adc"
    rootFolderId      = var.root_folder_id
    archiveFolderId   = var.archive_folder_id
    sharedDriveId     = var.shared_drive_id
    maxMarkdownBytes  = var.max_markdown_bytes
    maxTraversalNodes = var.max_traversal_nodes
    maxPages          = var.max_pages
    maxResults        = var.max_results
    } : {
    authMode          = "my-drive-refresh-token"
    rootFolderId      = var.root_folder_id
    archiveFolderId   = var.archive_folder_id
    oauthSecretFile   = local.oauth_secret_file
    maxMarkdownBytes  = var.max_markdown_bytes
    maxTraversalNodes = var.max_traversal_nodes
    maxPages          = var.max_pages
    maxResults        = var.max_results
  }

  service_config = {
    drive = local.drive_config
    authentication = {
      workMcp = {
        issuer                 = var.work_mcp_issuer
        audience               = var.work_mcp_audience
        jwksUrl                = var.work_mcp_jwks_url
        allowedAlgorithms      = var.work_mcp_allowed_algorithms
        clockToleranceSeconds  = var.work_mcp_clock_tolerance_seconds
        jwksTimeoutMs          = var.work_mcp_jwks_timeout_ms
        jwksCacheMaxAgeMs      = var.work_mcp_jwks_cache_max_age_ms
      }
      codex = {
        bearerSecretFile = local.codex_secret_file
      }
    }
    http = {
      maxRequestMarkdownBytes           = var.max_markdown_bytes
      maxJsonBodyBytes                  = var.max_json_body_bytes
      maxResultItems                    = var.max_results
      maxJsonResponseBytes              = var.max_json_response_bytes
      requestTimeoutMs                  = var.http_request_timeout_ms
      rateLimitWindowMs                 = var.rate_limit_window_ms
      maxRequestsPerWindow              = var.max_requests_per_window
      maxConcurrentRequestsPerPrincipal = var.max_concurrent_requests_per_principal
      maxRateLimitPrincipals            = var.max_rate_limit_principals
    }
  }
}

resource "google_cloud_run_v2_service" "gateway" {
  name     = var.service_name
  location = var.region
  ingress  = var.ingress

  template {
    service_account                  = google_service_account.runtime.email
    timeout                          = "${var.request_timeout_seconds}s"
    max_instance_request_concurrency = var.container_concurrency

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.container_image

      env {
        name  = "PORT"
        value = "8080"
      }

      env {
        name  = "GATEWAY_SERVICE_CONFIG_JSON"
        value = jsonencode(local.service_config)
      }

      resources {
        limits = {
          cpu    = var.cpu
          memory = var.memory
        }
      }

      startup_probe {
        http_get {
          path = "/healthz"
          port = 8080
        }
        initial_delay_seconds = 0
        timeout_seconds       = 3
        period_seconds        = 10
        failure_threshold     = 3
      }

      volume_mounts {
        name       = "codex-bearer"
        mount_path = var.codex_secret_mount_path
      }

      dynamic "volume_mounts" {
        for_each = local.oauth_secret_references
        content {
          name       = "my-drive-oauth"
          mount_path = var.oauth_secret_mount_path
        }
      }
    }

    volumes {
      name = "codex-bearer"
      secret {
        secret = var.codex_bearer_secret_id
        items {
          version = var.codex_bearer_secret_version
          path    = "bearer"
        }
      }
    }

    dynamic "volumes" {
      for_each = local.oauth_secret_references
      content {
        name = "my-drive-oauth"
        secret {
          secret = each.value.id
          items {
            version = each.value.version
            path    = "credentials.json"
          }
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = var.drive_auth_mode != "shared-drive-adc" || (var.shared_drive_id != null && trimspace(var.shared_drive_id) != "")
      error_message = "shared-drive-adc requires a non-blank shared_drive_id."
    }
    precondition {
      condition     = var.drive_auth_mode != "my-drive-refresh-token" || (var.oauth_secret_id != null && trimspace(var.oauth_secret_id) != "")
      error_message = "my-drive-refresh-token requires an existing oauth_secret_id."
    }
    precondition {
      condition     = var.max_instances >= var.min_instances
      error_message = "max_instances must be at least min_instances."
    }
    precondition {
      condition     = var.request_timeout_seconds * 1000 > var.http_request_timeout_ms + 1000
      error_message = "request_timeout_seconds must exceed the API deadline by at least one second."
    }
    precondition {
      condition     = !var.allow_public_invoker || var.acknowledge_public_invoker
      error_message = "Set acknowledge_public_invoker=true only after approving public Cloud Run invocation."
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count = var.allow_public_invoker ? 1 : 0

  location = google_cloud_run_v2_service.gateway.location
  name     = google_cloud_run_v2_service.gateway.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
