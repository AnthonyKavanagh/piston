#!/bin/bash
set -e

echo "🚀 Starting Piston deployment to EC2..."

# Configuration
PISTON_DIR="/opt/piston"
DATA_DIR="/opt/piston/data"

# Use custom built image from GitHub Actions (your modified Piston code)
# This is set by the GitHub Actions workflow with your custom changes
DEFAULT_IMAGE="ghcr.io/engineer-man/piston:latest"
if [ -z "$CUSTOM_IMAGE" ]; then
    IMAGE="$DEFAULT_IMAGE"
else
    IMAGE="$CUSTOM_IMAGE"
fi

# Ensure a tag is present (avoid clobbering registry port definitions)
if [[ "${IMAGE##*/}" != *:* ]]; then
    IMAGE="${IMAGE}:latest"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to log messages
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
    log_warn "This script should be run as root. Attempting to continue..."
fi

# Create directories
log_info "Creating directories..."
sudo mkdir -p $PISTON_DIR $DATA_DIR/piston/packages

# Log in to ECR when pulling a private ECR image
if [[ "$IMAGE" == *.amazonaws.com/* ]]; then
    # Derive ECR registry and region from the image name
    ECR_REGISTRY="${IMAGE%%/*}"
    # If AWS_REGION is not provided, try to parse it from the registry host
    if [ -z "$AWS_REGION" ]; then
        AWS_REGION=$(echo "$ECR_REGISTRY" | awk -F'.' '{print $(NF-3)}')
        if [ -z "$AWS_REGION" ]; then
            log_error "AWS_REGION not set and could not be derived from $ECR_REGISTRY"
            exit 1
        else
            log_info "Derived AWS_REGION=$AWS_REGION from registry host"
        fi
    fi

    # Ensure aws cli is present (for role-based auth on the instance)
    if ! command -v aws &> /dev/null; then
        log_warn "AWS CLI not installed; attempting to install awscli"
        sudo apt-get update -y >/dev/null 2>&1 || true
        sudo apt-get install -y awscli >/dev/null 2>&1 || true
    fi

    if command -v aws &> /dev/null; then
        log_info "Logging in to ECR registry: $ECR_REGISTRY"
        if ! aws ecr get-login-password --region "$AWS_REGION" | sudo docker login --username AWS --password-stdin "$ECR_REGISTRY"; then
            log_error "ECR login failed. Ensure the EC2 instance role has ECR pull permissions and AWS CLI can obtain credentials."
            exit 1
        fi
    else
        log_error "AWS CLI missing; cannot log in to ECR. Install awscli or ensure it is available."
        exit 1
    fi
fi

# Pull latest image
log_info "Pulling Piston image: $IMAGE"
sudo docker pull $IMAGE || {
    log_error "Failed to pull image. Attempting to use local image..."
}

# Stop existing container if running
log_info "Stopping existing Piston container..."
sudo docker stop piston_api 2>/dev/null || log_warn "No existing container to stop"

# Remove existing container
log_info "Removing existing Piston container..."
sudo docker rm piston_api 2>/dev/null || log_warn "No existing container to remove"

# Start new container
log_info "Starting new Piston container..."
sudo docker run -d \
    --name piston_api \
    --restart always \
    --privileged \
    -p 2000:2000 \
    -v $DATA_DIR/piston/packages:/piston/packages \
    --tmpfs /tmp:exec \
    $IMAGE

# Wait for container to be ready
log_info "Waiting for Piston API to be ready..."
max_attempts=30
attempt=0
while [ $attempt -lt $max_attempts ]; do
    if sudo docker exec piston_api curl -s http://localhost:2000/api/v2/runtimes > /dev/null 2>&1; then
        log_info "✅ Piston API is ready!"
        break
    fi
    attempt=$((attempt + 1))
    sleep 2
    echo -n "."
done

if [ $attempt -eq $max_attempts ]; then
    log_error "Piston API did not start within expected time"
    log_info "Container logs:"
    sudo docker logs piston_api | tail -20
    exit 1
fi

# Verify container health
log_info "Verifying container health..."
if sudo docker inspect piston_api | grep -q '"Status": "running"'; then
    log_info "✅ Container is running"
else
    log_error "Container is not running"
    exit 1
fi

# Clean up old images
log_info "Cleaning up old Docker images..."
sudo docker image prune -f --filter "dangling=true" > /dev/null 2>&1 || true

log_info "✅ Deployment completed successfully!"
log_info "Piston API is available at: http://localhost:2000"
log_info "View logs with: sudo docker logs -f piston_api"
