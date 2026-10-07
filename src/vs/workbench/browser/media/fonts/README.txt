Fira Code 6.2, unmodified variable TrueType font (weights 300-700).
Source: https://github.com/tonsky/FiraCode/releases/download/6.2/Fira_Code_v6.2.zip
Archive member: variable_ttf/FiraCode-VF.ttf
License: SIL Open Font License 1.1, included in LICENSE.txt.

The identical copy in extensions/shortestpath.setup/resources/fonts is used by
setup webviews, which cannot inherit the workbench document's @font-face rules.
Update both font files and licenses together. bundledFont.test.ts checks parity.
