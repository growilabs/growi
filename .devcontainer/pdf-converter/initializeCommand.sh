# prevent file not found error on docker compose up
if [ ! -f ".devcontainer/compose.extend.yml" ]; then

cat > ".devcontainer/compose.extend.yml" <<EOF
services:
  {}
EOF

fi
