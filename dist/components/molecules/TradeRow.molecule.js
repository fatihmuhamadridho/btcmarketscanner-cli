import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
export function TradeRow({ label, value, accent, }) {
    return (_jsxs(Box, { justifyContent: "space-between", children: [_jsx(Text, { color: "#8b949e", children: label }), _jsx(Text, { color: accent ?? '#f5f5f5', bold: true, children: value })] }));
}
