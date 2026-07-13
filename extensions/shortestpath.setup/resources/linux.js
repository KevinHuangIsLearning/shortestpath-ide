'use strict';

exports.createCommand = ({ toolchainRoot, source }) => {
	const condaForge = source?.condaForgeChannel ?? 'conda-forge';
	const command = `set -eu; root='${toolchainRoot}'; mkdir -p "$root"; arch=$(uname -m); case "$arch" in x86_64) platform=linux-64 ;; aarch64|arm64) platform=linux-aarch64 ;; *) echo "Unsupported Linux architecture: $arch"; exit 1 ;; esac; curl -Ls "https://micro.mamba.pm/api/micromamba/$platform/latest" | tar -xvj -C "$root" bin/micromamba; "$root/bin/micromamba" create -y -p "$root/env" -c '${condaForge}' gxx_linux-64 clang-tools`;
	return command;
};

exports.createProcess = input => ({ executable: 'bash', args: ['-lc', exports.createCommand(input)], displayName: 'Portable toolchain' });
