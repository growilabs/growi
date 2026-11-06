"""Static checks of the sample Kubernetes manifests under deploy/k8s.

No cluster is available in CI for this service, so the tests parse the YAML and
assert the hardening and sizing contract (design.md: Security Considerations,
Memory budget).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml

K8S_DIR = Path(__file__).parents[1] / "deploy" / "k8s"
APP_PORT = 8000
TIMEOUT_S = 55
UPLOAD_TIMEOUT_S = 15
MAX_FILE_SIZE_MB = 50
RUNNER_PROBE_TIMEOUT_S = 10

if not K8S_DIR.is_dir():
    pytest.skip(f"manifests directory {K8S_DIR} is absent", allow_module_level=True)


def _load(name: str) -> dict[str, Any]:
    docs = [d for d in yaml.safe_load_all((K8S_DIR / name).read_text()) if d is not None]
    assert len(docs) == 1, f"{name} must hold exactly one resource"
    return docs[0]


@pytest.fixture(scope="module")
def deployment() -> dict[str, Any]:
    return _load("deployment.yaml")


@pytest.fixture(scope="module")
def service() -> dict[str, Any]:
    return _load("service.yaml")


@pytest.fixture(scope="module")
def hpa() -> dict[str, Any]:
    return _load("hpa.yaml")


@pytest.fixture(scope="module")
def netpol() -> dict[str, Any]:
    return _load("networkpolicy.yaml")


@pytest.fixture(scope="module")
def pod_spec(deployment: dict[str, Any]) -> dict[str, Any]:
    return deployment["spec"]["template"]["spec"]


@pytest.fixture(scope="module")
def container(pod_spec: dict[str, Any]) -> dict[str, Any]:
    containers = pod_spec["containers"]
    assert len(containers) == 1
    return containers[0]


def _env(container: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {e["name"]: e for e in container["env"]}


def _mem_mi(value: str) -> int:
    assert value.endswith("Mi") or value.endswith("Gi"), value
    return int(value[:-2]) * (1024 if value.endswith("Gi") else 1)


class TestSecurityContext:
    def test_container_is_hardened(self, container: dict[str, Any]) -> None:
        sc = container["securityContext"]
        assert sc["runAsNonRoot"] is True
        assert sc["runAsUser"] == 10001
        assert sc["readOnlyRootFilesystem"] is True
        assert sc["allowPrivilegeEscalation"] is False
        assert sc["capabilities"]["drop"] == ["ALL"]
        assert "add" not in sc["capabilities"]
        assert sc["seccompProfile"]["type"] == "RuntimeDefault"

    def test_pod_runs_as_the_image_user(self, pod_spec: dict[str, Any]) -> None:
        sc = pod_spec["securityContext"]
        assert sc["runAsNonRoot"] is True
        assert sc["runAsUser"] == 10001
        assert sc["seccompProfile"]["type"] == "RuntimeDefault"

    def test_service_account_token_is_not_mounted(self, pod_spec: dict[str, Any]) -> None:
        assert pod_spec["automountServiceAccountToken"] is False

    def test_no_host_access(self, pod_spec: dict[str, Any]) -> None:
        for key in ("hostNetwork", "hostPID", "hostIPC"):
            assert pod_spec.get(key, False) is False


class TestTmpVolume:
    def test_tmp_is_a_size_limited_memory_emptydir(self, pod_spec: dict[str, Any], container: dict[str, Any]) -> None:
        mounts = {m["mountPath"]: m["name"] for m in container["volumeMounts"]}
        assert list(mounts) == ["/tmp"], "/tmp must be the only writable mount"
        volume = next(v for v in pod_spec["volumes"] if v["name"] == mounts["/tmp"])
        assert volume["emptyDir"]["medium"] == "Memory"
        assert _mem_mi(volume["emptyDir"]["sizeLimit"]) <= 128
        assert len(pod_spec["volumes"]) == 1


class TestStatelessness:
    def test_deployment_has_no_persistent_storage(self, deployment: dict[str, Any], pod_spec: dict[str, Any]) -> None:
        assert deployment["kind"] == "Deployment"
        assert not any("persistentVolumeClaim" in v for v in pod_spec["volumes"])


class TestResources:
    def test_memory_requests_and_limits(self, container: dict[str, Any]) -> None:
        res = container["resources"]
        assert res["requests"]["memory"] == "512Mi"
        assert res["limits"]["memory"] == "2Gi"

    def test_cpu_is_set_and_sane(self, container: dict[str, Any]) -> None:
        res = container["resources"]
        assert "cpu" in res["requests"]
        assert "cpu" in res["limits"]

    def test_limit_covers_the_documented_budget(self, container: dict[str, Any]) -> None:
        # WORKERS*120 + WORKERS*MAX_CONCURRENCY*(MAX_CHILD_RSS_MB + 100 + 2*MAX_FILE_SIZE_MB + 48),
        # defaults 1 / 3 / 320 / 50: the upload is held in memory, twice its size while parsed.
        env = _env(container)
        workers = int(env["WORKERS"]["value"])
        concurrency = int(env["MAX_CONCURRENCY"]["value"])
        budget = workers * 120 + workers * concurrency * (320 + 100 + 2 * MAX_FILE_SIZE_MB + 48)
        assert budget <= _mem_mi(container["resources"]["limits"]["memory"])


class TestEnv:
    def test_sizing_env(self, container: dict[str, Any]) -> None:
        env = _env(container)
        assert env["WORKERS"]["value"] == "1"
        assert env["MAX_CONCURRENCY"]["value"] == "3"

    def test_token_comes_from_a_secret_never_a_literal(self, container: dict[str, Any]) -> None:
        entry = _env(container)["ATTACHMENT_EXTRACTOR_SERVICE_TOKEN"]
        assert "value" not in entry
        ref = entry["valueFrom"]["secretKeyRef"]
        assert ref["name"]
        assert ref["key"]

    def test_image_is_pinned_not_latest(self, container: dict[str, Any]) -> None:
        image = container["image"]
        assert ":" in image.rsplit("/", 1)[-1] or "@sha256:" in image
        assert not image.endswith(":latest")

    def test_no_shared_memory_volume(self, pod_spec: dict[str, Any]) -> None:
        assert all(v["name"] != "dev-shm" for v in pod_spec["volumes"])


class TestProbes:
    def test_startup_and_liveness_use_healthz(self, container: dict[str, Any]) -> None:
        for key in ("startupProbe", "livenessProbe"):
            probe = container[key]
            assert probe["httpGet"]["path"] == "/healthz"
            assert probe["httpGet"]["port"] == APP_PORT

    def test_readiness_uses_readyz_with_a_timeout_above_the_runner_probe(self, container: dict[str, Any]) -> None:
        probe = container["readinessProbe"]
        assert probe["httpGet"]["path"] == "/readyz"
        assert probe["httpGet"]["port"] == APP_PORT
        # runner probe_timeout_s + ~0.5s + reaping
        assert probe["timeoutSeconds"] >= RUNNER_PROBE_TIMEOUT_S + 5
        assert probe["periodSeconds"] >= probe["timeoutSeconds"]
        assert probe["failureThreshold"] >= 2

    def test_liveness_does_not_kill_a_busy_pod(self, container: dict[str, Any]) -> None:
        probe = container["livenessProbe"]
        assert probe["failureThreshold"] * probe["periodSeconds"] >= 30

    def test_startup_allows_slow_start(self, container: dict[str, Any]) -> None:
        probe = container["startupProbe"]
        assert probe["failureThreshold"] * probe["periodSeconds"] >= 30


class TestRollout:
    def test_grace_period_outlasts_an_upload_and_a_conversion(self, pod_spec: dict[str, Any]) -> None:
        assert pod_spec["terminationGracePeriodSeconds"] >= UPLOAD_TIMEOUT_S + TIMEOUT_S + 10

    def test_rolling_update_keeps_capacity(self, deployment: dict[str, Any]) -> None:
        assert deployment["spec"]["strategy"]["rollingUpdate"]["maxUnavailable"] == 0


class TestService:
    def test_cluster_ip_on_the_app_port(self, service: dict[str, Any]) -> None:
        assert service["kind"] == "Service"
        assert service["spec"].get("type", "ClusterIP") == "ClusterIP"
        assert [p["port"] for p in service["spec"]["ports"]] == [APP_PORT]
        assert service["spec"]["ports"][0]["targetPort"] == APP_PORT


class TestHpa:
    def test_autoscaling_v2_on_cpu(self, hpa: dict[str, Any], deployment: dict[str, Any]) -> None:
        assert hpa["apiVersion"] == "autoscaling/v2"
        assert hpa["kind"] == "HorizontalPodAutoscaler"
        ref = hpa["spec"]["scaleTargetRef"]
        assert ref == {"apiVersion": "apps/v1", "kind": "Deployment", "name": deployment["metadata"]["name"]}
        assert 2 <= hpa["spec"]["minReplicas"] < hpa["spec"]["maxReplicas"] <= 50
        cpu = next(m for m in hpa["spec"]["metrics"] if m["type"] == "Resource" and m["resource"]["name"] == "cpu")
        assert cpu["resource"]["target"]["type"] == "Utilization"
        assert 50 <= cpu["resource"]["target"]["averageUtilization"] <= 80

    def test_scale_down_is_slow(self, hpa: dict[str, Any]) -> None:
        assert hpa["spec"]["behavior"]["scaleDown"]["stabilizationWindowSeconds"] >= 300


class TestNetworkPolicy:
    def test_egress_is_blocked(self, netpol: dict[str, Any]) -> None:
        spec = netpol["spec"]
        assert netpol["kind"] == "NetworkPolicy"
        assert "Egress" in spec["policyTypes"]
        assert spec.get("egress", []) == []

    def test_ingress_is_limited_to_the_app_port_from_the_growi_app(self, netpol: dict[str, Any]) -> None:
        spec = netpol["spec"]
        assert "Ingress" in spec["policyTypes"]
        rules = spec["ingress"]
        assert len(rules) == 1
        rule = rules[0]
        assert [p["port"] for p in rule["ports"]] == [APP_PORT]
        assert rule["from"], "ingress must name a peer, not allow everything"
        for peer in rule["from"]:
            assert peer.get("namespaceSelector") or peer.get("podSelector")
            assert "ipBlock" not in peer


class TestConsistency:
    def test_labels_and_names_line_up(
        self,
        deployment: dict[str, Any],
        service: dict[str, Any],
        netpol: dict[str, Any],
    ) -> None:
        pod_labels = deployment["spec"]["template"]["metadata"]["labels"]
        assert deployment["spec"]["selector"]["matchLabels"].items() <= pod_labels.items()
        assert service["spec"]["selector"].items() <= pod_labels.items()
        assert netpol["spec"]["podSelector"]["matchLabels"].items() <= pod_labels.items()

    def test_all_resources_share_a_namespace_convention(self, deployment, service, hpa, netpol) -> None:  # type: ignore[no-untyped-def]
        namespaces = {r["metadata"].get("namespace") for r in (deployment, service, hpa, netpol)}
        assert len(namespaces) == 1

    def test_no_todo_markers(self) -> None:
        for path in K8S_DIR.glob("*.yaml"):
            assert "TODO" not in path.read_text()
