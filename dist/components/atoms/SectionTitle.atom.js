import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { Text } from 'ink';
export function SectionTitle({ text }) {
    return (_jsx(Text, { color: "#7ee7ff", bold: true, children: text }));
}
