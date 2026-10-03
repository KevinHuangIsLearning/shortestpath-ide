import React, { useState } from 'react';
import Page from './Page';

interface ImportCasesProps {
    t: (key: string) => string;
    notify: (msg: string) => void;
    importPageVisible: boolean;
    setImportPageVisible: (visible: boolean) => void;
    importCases: (cases: { input: string; output: string }[]) => void;
}

export const ImportCases: React.FC<ImportCasesProps> = ({
    t,
    notify,
    importPageVisible,
    setImportPageVisible,
    importCases,
}) => {
    const [fileName, setFileName] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<string | null>(null);
    const [parsedCases, setParsedCases] = useState<
        { input: string; output: string }[] | null
    >(null);

    if (!importPageVisible) {
        return null;
    }

    const reset = () => {
        setFileName(null);
        setValidationError(null);
        setParsedCases(null);
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) {
            return;
        }

        setFileName(file.name);
        setValidationError(null);
        setParsedCases(null);

        const reader = new FileReader();
        reader.onload = (event) => {
            const text = event.target?.result as string;
            try {
                const json = JSON.parse(text);
                if (!Array.isArray(json)) {
                    setValidationError(t('jsonRootMustBeArray'));
                    return;
                }

                const casesList: { input: string; output: string }[] = [];
                for (let i = 0; i < json.length; i++) {
                    const item = json[i];
                    if (item === null || typeof item !== 'object') {
                        setValidationError(
                            t('itemNotValidObject').replace(
                                '{index}',
                                i.toString(),
                            ),
                        );
                        return;
                    }
                    if (typeof item.input !== 'string') {
                        setValidationError(
                            t('itemMissingInput').replace(
                                '{index}',
                                i.toString(),
                            ),
                        );
                        return;
                    }
                    if (typeof item.output !== 'string') {
                        setValidationError(
                            t('itemMissingOutput').replace(
                                '{index}',
                                i.toString(),
                            ),
                        );
                        return;
                    }
                    casesList.push({
                        input: item.input,
                        output: item.output,
                    });
                }

                if (casesList.length === 0) {
                    setValidationError(t('arrayContainsNoCases'));
                    return;
                }

                setParsedCases(casesList);
            } catch (err: any) {
                setValidationError(
                    t('invalidJsonFormat').replace('{message}', err.message),
                );
            }
        };
        reader.onerror = () => {
            setValidationError(t('failedToReadFile'));
        };
        reader.readAsText(file);
    };

    const handleImport = () => {
        if (parsedCases && parsedCases.length > 0) {
            importCases(parsedCases);
            notify(t('testcasesImported'));
            setImportPageVisible(false);
            reset();
        }
    };

    const exampleJson = JSON.stringify(
        [
            {
                input: 'Tim Apple\n4 6',
                output: '3\n12',
            },
            {
                input: 'John Doe\n10 20',
                output: 'No',
            },
        ],
        null,
        2,
    );

    const content = (
        <div className="import-body">
            <p className="import-description">{t('importCasesDescription')}</p>

            <details className="import-example">
                <summary>{t('exampleFormat')}</summary>
                <textarea
                    className="selectable import-example-json"
                    readOnly
                    value={exampleJson}
                />
            </details>

            <div className="import-file-picker">
                <input
                    type="file"
                    id="cph-import-file-picker"
                    accept=".json"
                    className="visually-hidden"
                    onChange={handleFileChange}
                />
                <label htmlFor="cph-import-file-picker" className="btn btn-blue">
                    <i className="codicon codicon-folder-opened" aria-hidden="true"></i>{' '}
                    {t('chooseFile')}
                </label>
                {fileName && (
                    <span className="import-file-name">
                        {t('selectedFile')} <strong>{fileName}</strong>
                    </span>
                )}
            </div>

            {validationError && (
                <p className="import-error" role="alert">
                    <strong>{t('validationError')}</strong> {validationError}
                </p>
            )}

            <button
                type="button"
                className="btn btn-green btn-block import-submit"
                onClick={handleImport}
                disabled={!parsedCases}
            >
                <i className="codicon codicon-check" aria-hidden="true"></i>{' '}
                {parsedCases
                    ? t('importNTestcases').replace(
                          '{count}',
                          parsedCases.length.toString(),
                      )
                    : t('importCasesTitle')}
            </button>
        </div>
    );

    return (
        <Page
            content={content}
            title={t('importCasesTitle')}
            closePage={() => {
                setImportPageVisible(false);
                reset();
            }}
        />
    );
};
