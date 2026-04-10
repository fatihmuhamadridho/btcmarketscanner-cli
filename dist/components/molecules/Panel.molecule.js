import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
export function Panel({ title, children, width, }) {
    return (_jsxs(Box, { width: width, borderStyle: "round", borderColor: "#3f3f3f", paddingX: 1, paddingY: 0, flexDirection: "column", children: [_jsx(Text, { bold: true, color: "#8be9fd", children: title }), _jsx(Box, { marginTop: 0, flexDirection: "column", children: children })] }));
}
