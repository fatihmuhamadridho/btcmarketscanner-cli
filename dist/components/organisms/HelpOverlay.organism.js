import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
import { Panel } from '../molecules/Panel.molecule.js';
import { formatAvailableCommands } from '../../lib/command-parser.js';
export function HelpOverlay({ width }) {
    return (_jsx(Panel, { title: "Slash Commands", width: width, children: _jsx(Box, { flexDirection: "column", children: formatAvailableCommands().map((entry) => (_jsxs(Text, { children: [_jsx(Text, { color: "#7ee7ff", children: entry.command }), ' ', _jsx(Text, { dimColor: true, children: entry.example ? `${entry.example} ` : '' }), _jsx(Text, { children: entry.description })] }, entry.command))) }) }));
}
