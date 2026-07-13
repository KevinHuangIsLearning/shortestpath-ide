'use strict';

exports.createCommand = ({ toolchainRoot, source }) => {
	const condaForge = source?.condaForgeChannel ?? 'conda-forge';
	const msys2 = source?.msys2Channel ?? 'msys2';
	const command = `$root='${toolchainRoot}'; New-Item -ItemType Directory -Force $root | Out-Null; $archive=Join-Path $root 'micromamba.tar.bz2'; Invoke-WebRequest -Uri https://micro.mamba.pm/api/micromamba/win-64/latest -OutFile $archive; tar xf $archive -C $root; $mamba=Join-Path $root 'Library\\bin\\micromamba.exe'; & $mamba create -y -p (Join-Path $root 'env') -c '${condaForge}' -c '${msys2}' m2w64-gcc llvm`;
	return command;
};

exports.createProcess = input => ({ executable: 'powershell.exe', args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', exports.createCommand(input)], displayName: 'Portable toolchain' });
