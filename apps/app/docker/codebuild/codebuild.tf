module "codebuild" {
  source = "cloudposse/codebuild/aws"

  name                = "growi-official-image-builder"
  description         = "The CodeBuild Project for GROWI official docker image"

  artifact_type       = "NO_ARTIFACTS"

  source_type         = "GITHUB"
  source_location     = "https://github.com/growilabs/growi.git"
  source_version      = "refs/heads/master"
  git_clone_depth     = 1

  buildspec           = "apps/app/docker/codebuild/buildspec.yml"

  # https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-available.html
  build_image         = "aws/codebuild/amazonlinux2-x86_64-standard:4.0"
  build_compute_type  = "BUILD_GENERAL1_LARGE"

  privileged_mode     = true

  cache_type          = "LOCAL"
  local_cache_modes   = ["LOCAL_DOCKER_LAYER_CACHE", "LOCAL_CUSTOM_CACHE"]

}
