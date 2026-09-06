variable "project_id" {
  type        = string
  description = "Google Cloud project that already has required APIs enabled."

  validation {
    condition     = trimspace(var.project_id) != ""
    error_message = "project_id must not be blank."
  }
}

variable "region" {
  type        = string
  description = "Single Cloud Run and Artifact Registry region."
  default     = "us-central1"

  validation {
    condition     = can(regex("^[a-z]+-[a-z]+[0-9]$", var.region))
    error_message = "region must be a Google Cloud region name."
  }
}

variable "service_name" {
  type        = string
  description = "Cloud Run service name."
  default     = "google-drive-markdown-gateway"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,61}[a-z0-9]$", var.service_name))
    error_message = "service_name must be a valid Cloud Run service name."
  }
}

variable "artifact_repository_id" {
  type        = string
  description = "Artifact Registry Docker repository ID."
  default     = "google-drive-markdown-gateway"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,62}$", var.artifact_repository_id))
    error_message = "artifact_repository_id must be a valid repository ID."
  }
}

variable "runtime_service_account_id" {
  type        = string
  description = "Dedicated least-privilege Cloud Run runtime service account ID."
  default     = "gdm-gateway-runtime"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{4,28}[a-z0-9]$", var.runtime_service_account_id))
    error_message = "runtime_service_account_id must be a valid service account ID."
  }
}

variable "container_image" {
  type        = string
  description = "Published Artifact Registry image pinned to an immutable sha256 digest."

  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "container_image must end with an immutable @sha256 digest."
  }
}

variable "drive_auth_mode" {
  type        = string
  description = "Google authentication mode selected by the Drive location."

  validation {
    condition     = contains(["shared-drive-adc", "my-drive-refresh-token"], var.drive_auth_mode)
    error_message = "drive_auth_mode must be shared-drive-adc or my-drive-refresh-token."
  }
}

variable "root_folder_id" {
  type        = string
  description = "Configured Markdown root folder ID."

  validation {
    condition     = trimspace(var.root_folder_id) != ""
    error_message = "root_folder_id must not be blank."
  }
}

variable "archive_folder_id" {
  type        = string
  description = "Configured archive folder ID, distinct from the root."

  validation {
    condition     = trimspace(var.archive_folder_id) != "" && var.archive_folder_id != var.root_folder_id
    error_message = "archive_folder_id must not be blank or equal root_folder_id."
  }
}

variable "shared_drive_id" {
  type        = string
  description = "Shared Drive ID. Required only in shared-drive-adc mode."
  default     = null
  nullable    = true
}

variable "oauth_secret_id" {
  type        = string
  description = "Existing Secret Manager OAuth credential secret ID. Required only in My Drive mode."
  default     = null
  nullable    = true
}

variable "oauth_secret_version" {
  type        = string
  description = "Mounted OAuth credential secret version; latest supports controlled rotation."
  default     = "latest"

  validation {
    condition     = trimspace(var.oauth_secret_version) != ""
    error_message = "oauth_secret_version must not be blank."
  }
}

variable "codex_bearer_secret_id" {
  type        = string
  description = "Existing Secret Manager Codex bearer secret ID; never a bearer value."

  validation {
    condition     = trimspace(var.codex_bearer_secret_id) != ""
    error_message = "codex_bearer_secret_id must not be blank."
  }
}

variable "codex_bearer_secret_version" {
  type        = string
  description = "Mounted Codex bearer secret version; latest supports rotation."
  default     = "latest"

  validation {
    condition     = trimspace(var.codex_bearer_secret_version) != ""
    error_message = "codex_bearer_secret_version must not be blank."
  }
}

variable "codex_secret_mount_path" {
  type        = string
  description = "Absolute Codex Secret Manager volume mount directory."
  default     = "/var/run/secrets/codex"

  validation {
    condition     = can(regex("^/[A-Za-z0-9_./-]+$", var.codex_secret_mount_path)) && !strcontains(var.codex_secret_mount_path, "..")
    error_message = "codex_secret_mount_path must be a normalized absolute path."
  }
}

variable "oauth_secret_mount_path" {
  type        = string
  description = "Absolute OAuth Secret Manager volume mount directory."
  default     = "/var/run/secrets/my-drive-oauth"

  validation {
    condition     = can(regex("^/[A-Za-z0-9_./-]+$", var.oauth_secret_mount_path)) && !strcontains(var.oauth_secret_mount_path, "..")
    error_message = "oauth_secret_mount_path must be a normalized absolute path."
  }
}

variable "work_mcp_issuer" {
  type        = string
  description = "HTTPS issuer URL for the Work MCP JWT principal."

  validation {
    condition     = can(regex("^https://[^/?#@]+(/[^?#]*)?$", lower(var.work_mcp_issuer)))
    error_message = "work_mcp_issuer must be an HTTPS URL without credentials, query, or fragment."
  }
}

variable "work_mcp_audience" {
  type        = string
  description = "Expected Work MCP JWT audience."

  validation {
    condition     = trimspace(var.work_mcp_audience) != ""
    error_message = "work_mcp_audience must not be blank."
  }
}

variable "work_mcp_jwks_url" {
  type        = string
  description = "HTTPS JWKS URL for the Work MCP JWT principal."

  validation {
    condition     = can(regex("^https://[^/?#@]+(/[^?#]*)?$", lower(var.work_mcp_jwks_url)))
    error_message = "work_mcp_jwks_url must be an HTTPS URL without credentials, query, or fragment."
  }
}

variable "work_mcp_allowed_algorithms" {
  type        = list(string)
  description = "Allowed asymmetric Work MCP JWT algorithms."
  default     = ["RS256"]

  validation {
    condition     = length(var.work_mcp_allowed_algorithms) > 0 && length(distinct(var.work_mcp_allowed_algorithms)) == length(var.work_mcp_allowed_algorithms) && alltrue([for algorithm in var.work_mcp_allowed_algorithms : contains(["RS256", "PS256", "ES256", "ES384", "EdDSA"], algorithm)])
    error_message = "work_mcp_allowed_algorithms must contain unique allowed asymmetric algorithms."
  }
}

variable "work_mcp_clock_tolerance_seconds" {
  type        = number
  description = "Maximum JWT clock skew in seconds."
  default     = 15

  validation {
    condition     = var.work_mcp_clock_tolerance_seconds >= 0 && var.work_mcp_clock_tolerance_seconds <= 300 && floor(var.work_mcp_clock_tolerance_seconds) == var.work_mcp_clock_tolerance_seconds
    error_message = "work_mcp_clock_tolerance_seconds must be an integer from 0 to 300."
  }
}

variable "work_mcp_max_token_lifetime_seconds" {
  type        = number
  description = "Maximum accepted Work MCP JWT issued-to-expiry lifetime in seconds."
  default     = 3600

  validation {
    condition     = var.work_mcp_max_token_lifetime_seconds >= 60 && var.work_mcp_max_token_lifetime_seconds <= 86400 && floor(var.work_mcp_max_token_lifetime_seconds) == var.work_mcp_max_token_lifetime_seconds
    error_message = "work_mcp_max_token_lifetime_seconds must be an integer from 60 to 86400."
  }
}

variable "work_mcp_jwks_timeout_ms" {
  type        = number
  description = "JWKS request timeout in milliseconds."
  default     = 5000

  validation {
    condition     = var.work_mcp_jwks_timeout_ms >= 100 && var.work_mcp_jwks_timeout_ms <= 30000 && floor(var.work_mcp_jwks_timeout_ms) == var.work_mcp_jwks_timeout_ms
    error_message = "work_mcp_jwks_timeout_ms must be an integer from 100 to 30000."
  }
}

variable "work_mcp_jwks_cache_max_age_ms" {
  type        = number
  description = "JWKS cache maximum age in milliseconds."
  default     = 60000

  validation {
    condition     = var.work_mcp_jwks_cache_max_age_ms >= 1000 && var.work_mcp_jwks_cache_max_age_ms <= 3600000 && floor(var.work_mcp_jwks_cache_max_age_ms) == var.work_mcp_jwks_cache_max_age_ms
    error_message = "work_mcp_jwks_cache_max_age_ms must be an integer from 1000 to 3600000."
  }
}

variable "max_markdown_bytes" {
  type        = number
  description = "Maximum Markdown bytes accepted and read."
  default     = 1000000

  validation {
    condition     = var.max_markdown_bytes >= 1 && var.max_markdown_bytes <= 10000000 && floor(var.max_markdown_bytes) == var.max_markdown_bytes
    error_message = "max_markdown_bytes must be an integer from 1 to 10000000."
  }
}

variable "max_traversal_nodes" {
  type        = number
  description = "Maximum Drive traversal nodes."
  default     = 1000

  validation {
    condition     = var.max_traversal_nodes >= 1 && var.max_traversal_nodes <= 10000 && floor(var.max_traversal_nodes) == var.max_traversal_nodes
    error_message = "max_traversal_nodes must be an integer from 1 to 10000."
  }
}

variable "max_pages" {
  type        = number
  description = "Maximum Drive API pages per operation."
  default     = 100

  validation {
    condition     = var.max_pages >= 1 && var.max_pages <= 100 && floor(var.max_pages) == var.max_pages
    error_message = "max_pages must be an integer from 1 to 100."
  }
}

variable "max_path_depth" {
  type        = number
  description = "Maximum verified relative-path depth."
  default     = 100

  validation {
    condition     = var.max_path_depth >= 1 && var.max_path_depth <= 100 && floor(var.max_path_depth) == var.max_path_depth
    error_message = "max_path_depth must be an integer from 1 to 100."
  }
}

variable "max_metadata_checks" {
  type        = number
  description = "Maximum Drive metadata checks per request."
  default     = 100000

  validation {
    condition     = var.max_metadata_checks >= 1 && var.max_metadata_checks <= 100000 && floor(var.max_metadata_checks) == var.max_metadata_checks
    error_message = "max_metadata_checks must be an integer from 1 to 100000."
  }
}

variable "max_content_search_files" {
  type        = number
  description = "Maximum file bodies read during one content search."
  default     = 1000

  validation {
    condition     = var.max_content_search_files >= 1 && var.max_content_search_files <= 10000 && floor(var.max_content_search_files) == var.max_content_search_files
    error_message = "max_content_search_files must be an integer from 1 to 10000."
  }
}

variable "max_results" {
  type        = number
  description = "Maximum Drive result count."
  default     = 100

  validation {
    condition     = var.max_results >= 1 && var.max_results <= 1000 && floor(var.max_results) == var.max_results
    error_message = "max_results must be an integer from 1 to 1000."
  }
}

variable "max_request_markdown_bytes" {
  type        = number
  description = "Maximum Markdown bytes accepted by the JSON API."
  default     = 1000000

  validation {
    condition     = var.max_request_markdown_bytes >= 1 && var.max_request_markdown_bytes <= 1048576 && floor(var.max_request_markdown_bytes) == var.max_request_markdown_bytes
    error_message = "max_request_markdown_bytes must be an integer from 1 to 1048576."
  }
}

variable "max_result_items" {
  type        = number
  description = "Maximum result items returned by the JSON API."
  default     = 100

  validation {
    condition     = var.max_result_items >= 1 && var.max_result_items <= 100 && floor(var.max_result_items) == var.max_result_items
    error_message = "max_result_items must be an integer from 1 to 100."
  }
}

variable "max_json_body_bytes" {
  type        = number
  description = "Maximum JSON body bytes."
  default     = 6004096

  validation {
    condition     = var.max_json_body_bytes >= 4096 && var.max_json_body_bytes <= 6295552 && floor(var.max_json_body_bytes) == var.max_json_body_bytes
    error_message = "max_json_body_bytes must be an integer from 4096 to 6295552."
  }
}

variable "max_json_response_bytes" {
  type        = number
  description = "Maximum JSON response bytes."
  default     = 1000000

  validation {
    condition     = var.max_json_response_bytes >= 4096 && var.max_json_response_bytes <= 6295552 && floor(var.max_json_response_bytes) == var.max_json_response_bytes
    error_message = "max_json_response_bytes must be an integer from 4096 to 6295552."
  }
}

variable "http_request_timeout_ms" {
  type        = number
  description = "Application response deadline in milliseconds."
  default     = 5000

  validation {
    condition     = var.http_request_timeout_ms >= 100 && var.http_request_timeout_ms <= 30000 && floor(var.http_request_timeout_ms) == var.http_request_timeout_ms
    error_message = "http_request_timeout_ms must be an integer from 100 to 30000."
  }
}

variable "rate_limit_window_ms" {
  type        = number
  description = "Per-principal rate-limit window in milliseconds."
  default     = 60000

  validation {
    condition     = var.rate_limit_window_ms >= 1000 && var.rate_limit_window_ms <= 60000 && floor(var.rate_limit_window_ms) == var.rate_limit_window_ms
    error_message = "rate_limit_window_ms must be an integer from 1000 to 60000."
  }
}

variable "max_requests_per_window" {
  type        = number
  description = "Maximum requests per rate-limit window."
  default     = 60

  validation {
    condition     = var.max_requests_per_window >= 1 && var.max_requests_per_window <= 120 && floor(var.max_requests_per_window) == var.max_requests_per_window
    error_message = "max_requests_per_window must be an integer from 1 to 120."
  }
}

variable "max_concurrent_requests_per_principal" {
  type        = number
  description = "Maximum concurrent requests per principal."
  default     = 4

  validation {
    condition     = var.max_concurrent_requests_per_principal >= 1 && var.max_concurrent_requests_per_principal <= 16 && floor(var.max_concurrent_requests_per_principal) == var.max_concurrent_requests_per_principal
    error_message = "max_concurrent_requests_per_principal must be an integer from 1 to 16."
  }
}

variable "max_rate_limit_principals" {
  type        = number
  description = "Bound for in-memory rate-limit principal tracking."
  default     = 1000

  validation {
    condition     = var.max_rate_limit_principals >= 1 && var.max_rate_limit_principals <= 10000 && floor(var.max_rate_limit_principals) == var.max_rate_limit_principals
    error_message = "max_rate_limit_principals must be an integer from 1 to 10000."
  }
}

variable "container_concurrency" {
  type        = number
  description = "Finite Cloud Run request concurrency per instance."
  default     = 20

  validation {
    condition     = var.container_concurrency >= 1 && var.container_concurrency <= 80 && floor(var.container_concurrency) == var.container_concurrency
    error_message = "container_concurrency must be an integer from 1 to 80."
  }
}

variable "request_timeout_seconds" {
  type        = number
  description = "Cloud Run request timeout, longer than the API deadline."
  default     = 30

  validation {
    condition     = var.request_timeout_seconds >= 5 && var.request_timeout_seconds <= 300 && floor(var.request_timeout_seconds) == var.request_timeout_seconds
    error_message = "request_timeout_seconds must be an integer from 5 to 300."
  }
}

variable "min_instances" {
  type        = number
  description = "Minimum Cloud Run instance count."
  default     = 0

  validation {
    condition     = var.min_instances >= 0 && var.min_instances <= 10 && floor(var.min_instances) == var.min_instances
    error_message = "min_instances must be an integer from 0 to 10."
  }
}

variable "max_instances" {
  type        = number
  description = "Maximum Cloud Run instance count."
  default     = 3

  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 100 && floor(var.max_instances) == var.max_instances
    error_message = "max_instances must be an integer from 1 to 100."
  }
}

variable "cpu" {
  type        = string
  description = "Cloud Run CPU limit."
  default     = "1"

  validation {
    condition     = contains(["1", "2", "4"], var.cpu)
    error_message = "cpu must be a supported bounded Cloud Run CPU limit."
  }
}

variable "memory" {
  type        = string
  description = "Cloud Run memory limit."
  default     = "512Mi"

  validation {
    condition     = contains(["512Mi", "1Gi", "2Gi", "4Gi", "8Gi"], var.memory)
    error_message = "memory must be one of 512Mi, 1Gi, 2Gi, 4Gi, or 8Gi."
  }
}

variable "ingress" {
  type        = string
  description = "Cloud Run ingress policy selected by the approved caller architecture."
  default     = "INGRESS_TRAFFIC_ALL"

  validation {
    condition     = contains(["INGRESS_TRAFFIC_ALL", "INGRESS_TRAFFIC_INTERNAL_ONLY", "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"], var.ingress)
    error_message = "ingress must be a supported Cloud Run v2 ingress mode."
  }
}

variable "allow_public_invoker" {
  type        = bool
  description = "Explicitly permit the allUsers Cloud Run Invoker binding; application auth remains required."
  default     = false
}

variable "acknowledge_public_invoker" {
  type        = bool
  description = "Explicit operator acknowledgement required before creating an allUsers binding."
  default     = false
}

variable "acknowledge_production_service_apply" {
  type        = bool
  description = "Explicit operator acknowledgement required before creating or changing the production Cloud Run service."
  default     = false
}

variable "enable_write" {
  type        = bool
  description = "Enables server-side Drive writer composition for a reviewed revision; default is read-only."
  default     = false
}

variable "acknowledge_write_risk" {
  type        = bool
  description = "Separate acknowledgement required with enable_write for a reviewed write-enabled revision."
  default     = false
}
