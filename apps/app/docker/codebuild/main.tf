terraform {
  backend "remote" {
    organization = "weseek"

    workspaces {
      name = "growi-official-image-builder"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  required_version = ">= 1.2.0"
}

provider "aws" {
  profile = "weseek"
  region  = "ap-northeast-1"
}
