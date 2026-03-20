const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const exe = b.addExecutable(.{
        .name = "zig-exchange-server",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    // Link against C library
    exe.linkLibC();

    // Compile SQLite amalgamation directly — no system library needed
    exe.addCSourceFile(.{
        .file = b.path("sqlite-amalgamation-3510200/sqlite3.c"),
        .flags = &.{"-DSQLITE_THREADSAFE=1"},
    });
    exe.addIncludePath(b.path("sqlite-amalgamation-3510200"));

    b.installArtifact(exe);

    const run_cmd = b.addRunArtifact(exe);
    if (b.args) |args| {
        run_cmd.addArgs(args);
    }

    const run_step = b.step("run", "Run the application");
    run_step.dependOn(&run_cmd.step);

    // Test step for integration tests
    const test_exe = b.addTest(.{
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/exchange/lcx_test.zig"),
            .target = target,
            .optimize = optimize,
        }),
    });

    test_exe.linkLibC();
    test_exe.addIncludePath(b.path("sqlite-amalgamation-3510200"));

    const run_test = b.addRunArtifact(test_exe);
    const test_step = b.step("test", "Run integration tests");
    test_step.dependOn(&run_test.step);

    // Automation scripts build step
    const automation_step = b.step("automation", "Build all automation scripts");

    // Define all automation scripts
    const automation_scripts = [_][]const u8{
        // Publishing & Registries (7)
        "registry-setup",
        "npm-publish",
        "docker-push",
        "github-release",
        "package-dist",
        "version-publish",
        "publish-all",
        // Setup & Initialization (4)
        "init-project",
        "setup-ci",
        "env-setup",
        "install-deps",
        // Testing & Quality (5)
        "lint-all",
        "format-code",
        "integration-test",
        "smoke-test",
        "performance-bench",
        // Security & Scanning (4)
        "security-scan",
        "security-audit",
        "dependency-check",
        "api-security-test",
        // Monitoring & Maintenance (5)
        "logs-search",
        "metrics-collect",
        "db-migrate",
        "update-deps",
        "clean-artifacts",
        // Analysis & Reporting (3)
        "changelog-gen",
        "code-stats",
        "health-report",
    };

    inline for (automation_scripts) |script_name| {
        const script_exe = b.addExecutable(.{
            .name = script_name,
            .root_module = b.createModule(.{
                // Reference shared automation scripts from Toolz submodule
                .root_source_file = b.path(
                    b.fmt("../Toolz/src/automation/{s}.zig", .{script_name}),
                ),
                .target = target,
                .optimize = optimize,
            }),
        });
        b.installArtifact(script_exe);
        automation_step.dependOn(&script_exe.step);
    }
}
