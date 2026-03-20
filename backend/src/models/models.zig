const std = @import("std");

pub const RegisterRequest = struct {
    email: []const u8,
    password: []const u8,
};

pub const LoginRequest = struct {
    email: []const u8,
    password: []const u8,
};

pub const UserResponse = struct {
    id: u32,
    email: []const u8,
    btc_address: []const u8,
    created_at: u64,
};

pub const AuthResponse = struct {
    success: bool,
    status: u16,
    user: UserResponse,
    token: []const u8,
};

pub const ErrorResponse = struct {
    success: bool,
    status: u16,
    err_msg: []const u8,
};

pub const HealthResponse = struct {
    status: []const u8,
    timestamp: u64,
    users: u32,
};
