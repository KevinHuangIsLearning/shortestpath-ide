#!/usr/bin/env python3

"""Interactively remove legacy Release binary assets with Textual.

Install the only dependency with `python3 -m pip install textual`.
Log in with `gh auth login` before confirming deletions.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any, Iterable

try:
	from textual import work
	from textual.app import App, ComposeResult
	from textual.containers import Center, Horizontal, ScrollableContainer, Vertical
	from textual.screen import ModalScreen
	from textual.widgets import Button, Checkbox, Footer, Header, Input, Label, Static, TextArea
except ImportError:
	print('This script needs Textual. Install it with: python3 -m pip install textual', file=sys.stderr)
	raise SystemExit(2)


DEFAULT_REPOSITORY = 'KevinHuangIsLearning/shortestpath-ide'
DEFAULT_BINARY_EXTENSIONS = ('.zip', '.exe')
TAG_VERSION_PATTERN = re.compile(r'(?:^|[-_])v(?P<version>\d+(?:\.\d+)+)(?:$|[-_])', re.IGNORECASE)
VERSION_PATTERN = re.compile(r'^\d+(?:\.\d+)+$')


@dataclass(frozen=True)
class Version:
	parts: tuple[int, ...]

	@classmethod
	def parse(cls, value: str) -> 'Version':
		if not VERSION_PATTERN.fullmatch(value):
			raise ValueError('版本号应是纯数字并以点分隔，例如 0.3.0。')
		return cls(tuple(int(part) for part in value.split('.')))

	def __lt__(self, other: 'Version') -> bool:
		length = max(len(self.parts), len(other.parts))
		return self.parts + (0,) * (length - len(self.parts)) < other.parts + (0,) * (length - len(other.parts))


@dataclass(frozen=True)
class ReleaseAsset:
	release_id: int
	release_name: str
	tag_name: str
	asset_id: int
	asset_name: str


@dataclass(frozen=True)
class ReleaseTarget:
	release_id: int
	release_name: str
	tag_name: str


def parse_release_version(tag_name: str) -> Version | None:
	match = TAG_VERSION_PATTERN.search(tag_name)
	return Version.parse(match.group('version')) if match else None


def is_binary_asset(asset_name: str, extensions: Iterable[str] = DEFAULT_BINARY_EXTENSIONS) -> bool:
	return asset_name.casefold().endswith(tuple(extension.casefold() for extension in extensions))


def gh_api(method: str, path: str, *, paginate: bool = False, fields: dict[str, str] | None = None) -> Any:
	command = ['gh', 'api', '--method', method]
	if paginate:
		command.extend(('--paginate', '--slurp'))
	if fields:
		for name, value in fields.items():
			command.extend(('-f', f'{name}={value}'))
	command.append(path)
	try:
		result = subprocess.run(command, check=False, capture_output=True, text=True)
	except FileNotFoundError as error:
		raise RuntimeError('未找到 gh。请先安装 GitHub CLI 并执行 gh auth login。') from error
	if result.returncode != 0:
		raise RuntimeError(f'gh api {method} {path} 失败：{result.stderr.strip()}')
	if not result.stdout:
		return None
	try:
		return json.loads(result.stdout)
	except json.JSONDecodeError as error:
		raise RuntimeError(f'gh api {method} {path} 返回了无效 JSON。') from error


def list_releases(repository: str) -> list[dict[str, Any]]:
	pages = gh_api('GET', f'/repos/{repository}/releases?per_page=100', paginate=True)
	if not isinstance(pages, list) or not all(isinstance(page, list) for page in pages):
		raise RuntimeError('GitHub API 返回了无法识别的 Release 列表。')
	return [release for page in pages for release in page if isinstance(release, dict)]


def collect_release_targets(releases: Iterable[dict[str, Any]], threshold: Version) -> list[tuple[ReleaseTarget, list[dict[str, Any]]]]:
	targets: list[tuple[ReleaseTarget, list[dict[str, Any]]]] = []
	for release in releases:
		if release.get('draft'):
			continue
		tag_name = release.get('tag_name')
		release_id = release.get('id')
		if not isinstance(tag_name, str) or not isinstance(release_id, int):
			continue
		version = parse_release_version(tag_name)
		if version is None or not version < threshold:
			continue
		release_name = release.get('name') if isinstance(release.get('name'), str) else tag_name
		assets = release.get('assets')
		targets.append((ReleaseTarget(release_id, release_name, tag_name), assets if isinstance(assets, list) else []))
	return targets


def collect_binary_assets(targets: Iterable[tuple[ReleaseTarget, list[dict[str, Any]]]]) -> list[ReleaseAsset]:
	assets_to_delete: list[ReleaseAsset] = []
	for target, assets in targets:
		for asset in assets:
			asset_id = asset.get('id')
			asset_name = asset.get('name')
			if isinstance(asset_id, int) and isinstance(asset_name, str) and is_binary_asset(asset_name):
				assets_to_delete.append(ReleaseAsset(target.release_id, target.release_name, target.tag_name, asset_id, asset_name))
	return assets_to_delete


class ConfirmDeletion(ModalScreen[bool]):
	CSS = """
	ConfirmDeletion { align: center middle; }
	#dialog { width: 64; height: auto; border: tall $error; background: $panel; padding: 1 2; }
	#dialog Button { margin: 1 1 0 0; }
	"""

	def __init__(self, count: int) -> None:
		super().__init__()
		self.count = count

	def compose(self) -> ComposeResult:
		with Vertical(id='dialog'):
			yield Label(f'确定删除选中的 {self.count} 个二进制文件吗？')
			yield Label('此操作无法恢复；Release 本身和 latest.json 不会被删除。')
			with Horizontal():
				yield Button('取消', id='cancel')
				yield Button('删除', id='confirm', variant='error')

	def on_button_pressed(self, event: Button.Pressed) -> None:
		self.dismiss(event.button.id == 'confirm')


class ConfirmReleaseNotes(ModalScreen[bool]):
	CSS = ConfirmDeletion.CSS

	def __init__(self, count: int) -> None:
		super().__init__()
		self.count = count

	def compose(self) -> ComposeResult:
		with Vertical(id='dialog'):
			yield Label(f'确定覆盖 {self.count} 个 Release 的说明吗？')
			yield Label('此操作会替换每个 Release 当前的说明。')
			with Horizontal():
				yield Button('取消', id='cancel')
				yield Button('更新说明', id='confirm', variant='warning')

	def on_button_pressed(self, event: Button.Pressed) -> None:
		self.dismiss(event.button.id == 'confirm')


class ReleaseCleanupApp(App[None]):
	TITLE = 'ShortestPath Release 二进制清理'
	CSS = """
	#controls { height: auto; padding: 1 2; }
	#threshold { width: 22; margin-right: 1; }
	#status { height: auto; padding: 0 2 1 2; color: $text-muted; }
	#release-notes { height: 6; margin: 0 2 1 2; }
	#assets { height: 1fr; border-top: solid $primary; padding: 0 2; }
	.asset { margin: 0 0 1 0; }
	#actions { height: auto; padding: 1 2; }
	#delete { margin-left: 1; }
	"""

	def __init__(self, repository: str, initial_threshold: str) -> None:
		super().__init__()
		self.repository = repository
		self.initial_threshold = initial_threshold
		self.assets: dict[str, ReleaseAsset] = {}
		self.release_targets: dict[int, ReleaseTarget] = {}

	def compose(self) -> ComposeResult:
		yield Header()
		with Horizontal(id='controls'):
			yield Input(value=self.initial_threshold, placeholder='例如 0.3.0', id='threshold')
			yield Button('读取 Release', id='load', variant='primary')
		yield Static('输入阈值后读取：仅列出低于该版本的 .zip 与 .exe。', id='status')
		yield TextArea('此版本不再受支持，请使用更新的版本。', id='release-notes')
		yield ScrollableContainer(id='assets')
		with Horizontal(id='actions'):
			yield Button('全选', id='select-all')
			yield Button('删除选中项', id='delete', variant='error', disabled=True)
			yield Button('批量更新说明', id='update-notes', variant='warning', disabled=True)
		yield Footer()

	def selected_assets(self) -> list[ReleaseAsset]:
		return [asset for widget_id, asset in self.assets.items() if self.query_one(f'#{widget_id}', Checkbox).value]

	def update_delete_button(self) -> None:
		self.query_one('#delete', Button).disabled = not self.selected_assets()
		self.query_one('#update-notes', Button).disabled = not self.release_targets

	async def on_button_pressed(self, event: Button.Pressed) -> None:
		if event.button.id == 'load':
			await self.load_assets()
		elif event.button.id == 'select-all':
			for checkbox in self.query('#assets Checkbox'):
				checkbox.value = True
			self.update_delete_button()
		elif event.button.id == 'delete':
			selected = self.selected_assets()
			if selected:
				self.push_screen(ConfirmDeletion(len(selected)), self.handle_delete_confirmation)
		elif event.button.id == 'update-notes':
			if not self.release_targets:
				return
			if not self.query_one('#release-notes', TextArea).text.strip():
				self.query_one('#status', Static).update('说明不能为空。')
				return
			self.push_screen(ConfirmReleaseNotes(len(self.release_targets)), self.handle_notes_confirmation)

	def on_checkbox_changed(self, _: Checkbox.Changed) -> None:
		self.update_delete_button()

	async def load_assets(self) -> None:
		threshold_text = self.query_one('#threshold', Input).value.strip()
		try:
			threshold = Version.parse(threshold_text)
		except ValueError as error:
			self.query_one('#status', Static).update(str(error))
			return

		self.query_one('#load', Button).disabled = True
		self.query_one('#status', Static).update('正在读取 GitHub Release…')
		try:
			releases = await asyncio.to_thread(list_releases, self.repository)
			targets = collect_release_targets(releases, threshold)
			assets = collect_binary_assets(targets)
		except RuntimeError as error:
			self.query_one('#status', Static).update(str(error))
			return
		finally:
			self.query_one('#load', Button).disabled = False

		container = self.query_one('#assets', ScrollableContainer)
		await container.remove_children()
		self.assets.clear()
		self.release_targets = {
			asset.release_id: ReleaseTarget(asset.release_id, asset.release_name, asset.tag_name)
			for asset in assets
		}
		for asset in assets:
			widget_id = f'asset-{asset.asset_id}'
			self.assets[widget_id] = asset
			await container.mount(Checkbox(f'{asset.tag_name}  ·  {asset.asset_name}', value=True, id=widget_id, classes='asset'))
		self.query_one('#status', Static).update(f'找到 {len(assets)} 个可删除二进制文件，涉及 {len(self.release_targets)} 个 Release；可取消勾选不想删除的项目。批量更新说明只会更新这些含二进制文件的 Release。')
		self.update_delete_button()

	def handle_notes_confirmation(self, confirmed: bool) -> None:
		if not confirmed:
			return
		body = self.query_one('#release-notes', TextArea).text.strip()
		targets = list(self.release_targets.values())
		self.update_release_notes(targets, body)

	@work(exclusive=True)
	async def update_release_notes(self, targets: list[ReleaseTarget], body: str) -> None:
		self.query_one('#update-notes', Button).disabled = True
		self.query_one('#delete', Button).disabled = True
		self.query_one('#load', Button).disabled = True
		self.query_one('#status', Static).update(f'正在更新 {len(targets)} 个 Release 的说明…')
		failed: list[str] = []
		for index, target in enumerate(targets, start=1):
			self.query_one('#status', Static).update(f'正在更新 {index}/{len(targets)}：{target.tag_name}')
			try:
				await asyncio.to_thread(gh_api, 'PATCH', f'/repos/{self.repository}/releases/{target.release_id}', fields={'body': body})
			except RuntimeError as error:
				failed.append(f'{target.tag_name}: {error}')

		if failed:
			self.query_one('#status', Static).update(f'有 {len(failed)} 个 Release 未能更新：{failed[0]}')
		else:
			self.query_one('#status', Static).update(f'已更新 {len(targets)} 个 Release 的说明。')
		self.query_one('#load', Button).disabled = False
		self.update_delete_button()

	def handle_delete_confirmation(self, confirmed: bool) -> None:
		if not confirmed:
			return
		self.delete_selected_assets(self.selected_assets())

	@work(exclusive=True)
	async def delete_selected_assets(self, selected: list[ReleaseAsset]) -> None:
		self.query_one('#delete', Button).disabled = True
		self.query_one('#update-notes', Button).disabled = True
		self.query_one('#load', Button).disabled = True
		self.query_one('#status', Static).update(f'正在删除 {len(selected)} 个文件…')
		failed: list[str] = []
		for index, asset in enumerate(selected, start=1):
			self.query_one('#status', Static).update(f'正在删除 {index}/{len(selected)}：{asset.asset_name}')
			try:
				await asyncio.to_thread(gh_api, 'DELETE', f'/repos/{self.repository}/releases/assets/{asset.asset_id}')
			except RuntimeError as error:
				failed.append(f'{asset.asset_name}: {error}')
			else:
				self.query_one(f'#asset-{asset.asset_id}', Checkbox).remove()
				self.assets.pop(f'asset-{asset.asset_id}', None)

		if failed:
			self.query_one('#status', Static).update(f'有 {len(failed)} 个文件未能删除：{failed[0]}')
		else:
			self.query_one('#status', Static).update(f'已删除 {len(selected)} 个二进制文件。')
		self.query_one('#load', Button).disabled = False
		self.update_delete_button()


def parse_arguments() -> argparse.Namespace:
	parser = argparse.ArgumentParser(description='以 Textual TUI 清理旧 GitHub Release 的 .zip/.exe 文件。')
	parser.add_argument('--repo', default=DEFAULT_REPOSITORY, help=f'GitHub repository（默认：{DEFAULT_REPOSITORY}）。')
	parser.add_argument('--before', default='', help='预填版本阈值，例如 0.3.0。')
	return parser.parse_args()


if __name__ == '__main__':
	arguments = parse_arguments()
	ReleaseCleanupApp(arguments.repo, arguments.before).run()
