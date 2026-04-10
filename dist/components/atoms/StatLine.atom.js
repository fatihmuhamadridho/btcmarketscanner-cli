import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { Text } from 'ink';
export function StatLine({ label, value, color }) {
    return (_jsxs(Text, { children: [_jsxs(Text, { color: "#8b949e", children: [label, " "] }), _jsx(Text, { color: color ?? '#f8f8f2', bold: true, children: value })] }));
}
