module "oidc_github" {
  source  = "unfunco/oidc-github/aws"

  iam_role_name = "GitHubOIDC-for-growi"
  iam_role_inline_policies = {
    "inline_policy" : data.aws_iam_policy_document.policy_document.json
  }

  github_repositories = [
    "growilabs/growi",
  ]
}

data "aws_iam_policy_document" "policy_document" {
  statement {
    actions   = [
      "codebuild:StartBuild",
      "codebuild:StopBuild",
      "codebuild:RetryBuild",
      "codebuild:BatchGetBuilds"
    ]
    resources = [
      module.codebuild.project_arn
    ]
  }
}
