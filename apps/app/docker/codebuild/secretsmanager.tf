resource "aws_secretsmanager_secret" "secret" {
  name = "growi/official-image-builder"
}

resource "aws_secretsmanager_secret_version" "main" {
  secret_id     = aws_secretsmanager_secret.secret.id
  secret_string = jsonencode({
    KEY1 = "CHANGE THIS"
    KEY2 = "CHANGE THIS"
  })

  lifecycle {
    ignore_changes = [secret_string, version_stages]
  }
}