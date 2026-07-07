# Kubernetes deployment (with KEDA autoscaling)

Reference manifests for running the orchestrator on Kubernetes, autoscaled by
**KEDA** on the BullMQ queue depth in Redis.

## Prerequisites
- A cluster (kind/minikube/EKS/GKE…) and `kubectl`.
- **KEDA** installed: `helm repo add kedacore https://kedacore.github.io/charts && helm install keda kedacore/keda -n keda --create-namespace`
- An NGINX ingress controller (for `50-ingress.yaml`), optional.

## Build & load the image
```bash
docker build -t s3-syncbridge-nestjs-app:latest ./nestjs-app
# kind: kind load docker-image s3-syncbridge-nestjs-app:latest
# or push to your registry and update image: refs in the manifests
```

## Deploy
```bash
# 1. Edit k8s/10-config.yaml secrets first (or use Sealed Secrets / External Secrets).
kubectl apply -k k8s/

# 2. Watch rollout
kubectl -n s3-syncbridge get pods -w
```

`db-migrate` (Job) applies migrations once; orchestrator pods start with the
image entrypoint's migration step bypassed (`command: node dist/main.js`).

## Autoscaling
`40-keda-scaledobject.yaml` scales the `orchestrator` Deployment between 1 and 10
replicas based on the length of `bull:file-transfers:wait` in Redis (~20 queued
jobs per replica). Drive load and watch it scale:
```bash
kubectl -n s3-syncbridge get hpa,scaledobject
kubectl -n s3-syncbridge get pods -l app=orchestrator -w
```

## Notes / limitations
- **SFTP ingestion & shared storage:** the worker reads the uploaded file from
  `INGESTION_DATA_ROOT`. In Kubernetes that requires an **RWX** volume shared with
  SFTPGo (NFS/EFS/CephFS), or switching the worker to pull the file over SFTP.
  These manifests deploy the orchestrator + its datastores; add SFTPGo with an
  RWX PVC (see the commented volume block in `30-orchestrator.yaml`).
- Datastores here are single-replica Deployments for simplicity — use
  StatefulSets / managed services (RDS, ElastiCache, S3) in production.
- Add TLS (cert-manager) and NetworkPolicies before exposing publicly.
