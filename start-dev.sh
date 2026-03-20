#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}================================${NC}"
echo -e "${BLUE}  Exchange Server - Full Stack ${NC}"
echo -e "${BLUE}================================${NC}\n"

# Check if Zig is installed
echo -e "${YELLOW}Checking Zig installation...${NC}"
if ! command -v zig &> /dev/null; then
    echo -e "${RED}✗ Zig is not installed!${NC}"
    echo "Download from: https://ziglang.org/download/"
    exit 1
fi
echo -e "${GREEN}✓ Zig found: $(zig version)${NC}\n"

# Check if Node.js is installed
echo -e "${YELLOW}Checking Node.js installation...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}✗ Node.js is not installed!${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Node.js found: $(node --version)${NC}\n"

# Install root devDependencies (concurrently) if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing root dependencies...${NC}"
    npm install
fi

# Install frontend dependencies if needed
if [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    cd frontend && npm install && cd ..
fi

echo -e "\n${BLUE}================================${NC}"
echo -e "${GREEN}Starting both servers...${NC}"
echo -e "${BLUE}================================${NC}\n"

# Detect external IP
EXTERNAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "YOUR_VPS_IP")

echo -e "${YELLOW}Backend (Zig):${NC}   http://0.0.0.0:8000"
echo -e "${YELLOW}Frontend (Vite):${NC} http://0.0.0.0:5173"
echo -e "${GREEN}Access from outside:${NC} http://${EXTERNAL_IP}:5173\n"

# Open firewall ports if ufw is available
if command -v ufw &> /dev/null; then
    echo -e "${YELLOW}Opening firewall ports...${NC}"
    ufw allow 5173/tcp > /dev/null 2>&1
    ufw allow 8000/tcp > /dev/null 2>&1
    ufw reload > /dev/null 2>&1
    echo -e "${GREEN}✓ Ports 5173 and 8000 open${NC}\n"
fi

# Start both servers
npm run start:all
