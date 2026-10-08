/*---------------------------------------------------------------------------------------------
 *  Copyright (c) 2026 ShortestPath IDE contributors.
 *  Licensed under the GPL-3.0-or-later license. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import React from 'react';
import { t } from '../i18n';
import { useMenuDismiss } from '../useMenuDismiss';

/**
 * Auxiliary entry point behind the header "⋯" button: help, feedback, about,
 * the companion toggle and the destructive problem actions. Long-running
 * judging controls deliberately stay out of this panel.
 *
 * A testcase card's "⋯" opens CaseActionsMenu, which shares this menu's chrome
 * and its dismissal behaviour.
 */
export default function AuxMenu(props: {
	projectUrl: string;
	userGuideHref: string;
	catCompanionEnabled: boolean;
	deleteArmed: boolean;
	tooltip?: React.ReactNode;
	onToggleCat: () => void;
	onOpenInfo: () => void;
	onOpenDashboard?: () => void;
	onDeleteProblem: () => void;
	onOpenGlobalSettings: () => void;
	onClose: () => void;
}) {
	useMenuDismiss(props.onClose, '[data-aux-menu-anchor]');

	return (
		<div className='menu aux-menu' role='group' aria-label={t('auxMenu')}>
			{props.tooltip}
			<button type='button' className='btn btn-black btn-block' onClick={props.onOpenDashboard}>{t('dashboard')}</button>
			<a
				className='btn btn-black btn-block'
				href={props.userGuideHref}
				title={t('userGuide')}
			>
				<i className='codicon codicon-book' aria-hidden='true'></i>{' '}
				{t('userGuide')}
			</a>
			<a
				className='btn btn-black btn-block'
				href={`${props.projectUrl}/issues`}
				title={t('bugs')}
			>
				<i className='codicon codicon-github' aria-hidden='true'></i>{' '}
				{t('bugs')}
			</a>
			<button
				type='button'
				className='btn btn-black btn-block'
				title={t('aboutCPH')}
				onClick={props.onOpenInfo}
			>
				<i className='codicon codicon-info' aria-hidden='true'></i>{' '}
				{t('about')}
			</button>
			<button
				type='button'
				className='btn btn-black btn-block'
				title={
					props.catCompanionEnabled
						? t('disableCatCompanion')
						: t('enableCatCompanion')
				}
				aria-pressed={props.catCompanionEnabled}
				onClick={props.onToggleCat}
			>
				<i className='codicon codicon-octoface' aria-hidden='true'></i>{' '}
				{t('cat')}
			</button>
			<button
				type='button'
				className='btn btn-black btn-block'
				title={t('settings')}
				onClick={props.onOpenGlobalSettings}
			>
				<i className='codicon codicon-settings' aria-hidden='true'></i>{' '}
				{t('settings')}
			</button>
			<button
				type='button'
				className={`btn btn-block ${props.deleteArmed ? 'btn-red' : 'btn-black'}`}
				title={props.deleteArmed ? t('confirm') : t('delete')}
				onClick={props.onDeleteProblem}
			>
				{props.deleteArmed ? (
					t('confirm')
				) : (
					<>
						<i className='codicon codicon-trash' aria-hidden='true'></i>{' '}
						{t('delete')}
					</>
				)}
			</button>
		</div>
	);
}
