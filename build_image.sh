#!/usr/bin/env bash
# Run on an architecture-matched build host; source is synchronized locally first.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SHEET=""; IMAGES=pgv-viewer; BUILD_ONLY=false
while [[ $# -gt 0 ]]; do
 case "$1" in
  --sheet) SHEET="$2"; shift 2 ;;
  --images) IMAGES="$2"; shift 2 ;;
  --build-only) BUILD_ONLY=true; shift ;;
  -h|--help) echo 'build_image.sh --sheet AMD_with_cuda|ARM_without_cuda --images pgv-viewer[,pgv] [--build-only]';exit 0 ;;
  *) echo "Unknown argument: $1" >&2;exit 1 ;;
 esac
done
case "$SHEET" in
 AMD_with_cuda|AMD_with_mxn100) PROFILE=amd;PLATFORM=linux/amd64 ;;
 ARM_without_cuda|ARM_with_cuda|l4t|thor_spark|SOPHON_bm1688) PROFILE=arm;PLATFORM=linux/arm64 ;;
 *) echo 'An explicit supported --sheet is required' >&2;exit 1 ;;
esac
BUILD_ROOT="${PGV_BUILD_ROOT:-$HOME/dev/build/pgv}"
mkdir -p "$BUILD_ROOT/context"
IFS=, read -ra SELECTED <<< "$IMAGES"
for component in "${SELECTED[@]}"; do
 case "$component" in
 pgv)
  args=(--profile "$PROFILE" --sheet "$SHEET")
  [[ "$BUILD_ONLY" != true ]] || args+=(--build-only)
  (cd "$ROOT/pgv" && ./build_image.sh "${args[@]}") ;;
 pgv-viewer)
  rsync -a --delete --exclude .git --exclude node_modules --exclude target --exclude dist "$ROOT/" "$BUILD_ROOT/context/"
  TAG="${PGV_VIEWER_IMAGE_TAG:-${PROFILE}_dbx_0.6.62_$(date +%Y%m%d%H%M%S)}"
  REPOSITORY=swr.cn-southwest-2.myhuaweicloud.com/ictrek/pgv-viewer
  IMAGE="$REPOSITORY:$TAG"
  docker buildx build --load --provenance=false --sbom=false --platform "$PLATFORM" --build-arg "RUST_IMAGE=${PGV_RUST_IMAGE:-rust:1-trixie}" -t "$IMAGE" \
    -f "$BUILD_ROOT/context/docker/vos/Dockerfile" "$BUILD_ROOT/context" > "$BUILD_ROOT/build-${PROFILE}.log" 2>&1 </dev/null
  node --test "$ROOT/docker/vos/gateway.test.mjs" "$ROOT/docker/vos/scheduler.test.mjs"
  PG_IMAGE="${PGV_VERIFY_IMAGE:-$(python3 "$ROOT/scripts/record_image.py" --sheet "$SHEET" --component pgv --repository swr.cn-southwest-2.myhuaweicloud.com/ictrek/pgv --resolve)}"
  REDIS_REPOSITORY=ictrek; [[ "$PROFILE" != arm ]] || REDIS_REPOSITORY=ictrek-arm
  python3 "$ROOT/scripts/verify_viewer_runtime.py" --image "$IMAGE" --postgres-image "$PG_IMAGE" --redis-image "swr.cn-southwest-2.myhuaweicloud.com/$REDIS_REPOSITORY/redis:7.0-alpine"
  if [[ "$BUILD_ONLY" == true ]]; then echo "Candidate built: $IMAGE";else
    docker push "$IMAGE"
    docker manifest inspect "$IMAGE" >/dev/null
    python3 "$ROOT/scripts/record_image.py" --sheet "$SHEET" --component pgv-viewer --repository "$REPOSITORY" --tag "$TAG"
  fi ;;
 *) echo "Unsupported image: $component" >&2;exit 1 ;;
 esac
done
