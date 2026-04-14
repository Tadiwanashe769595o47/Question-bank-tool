import sys

with open('src/App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    "import { pushQuestionsToSupabase, testSupabaseConnection, getExistingQuestionTexts, fetchHistory, HistoryRecord } from \"./services/supabaseService\";",
    "import { pushQuestionsToSupabase, testSupabaseConnection, getExistingQuestionTexts, fetchHistory, HistoryRecord, checkStorageBucket } from \"./services/supabaseService\";"
)

content = content.replace(
    "  const abortControllerRef = useRef<AbortController | null>(null);\r\n\r\n  useEffect(() => {",
    "  const abortControllerRef = useRef<AbortController | null>(null);\r\n\r\n  // Storage bucket health status\r\n  const [storageStatus, setStorageStatus] = useState<'checking' | 'ok' | 'bucket_missing' | 'policy_blocked' | 'unknown_error'>('checking');\r\n\r\n  useEffect(() => {"
)

content = content.replace(
    "    testSupabaseConnection().then(success => {\r\n      setConnectionStatus(success ? 'connected' : 'error');\r\n    });\r\n    \r\n    // Load drafts",
    "    testSupabaseConnection().then(success => {\r\n      setConnectionStatus(success ? 'connected' : 'error');\r\n    });\r\n    checkStorageBucket().then(status => setStorageStatus(status));\r\n    \r\n    // Load drafts"
)

with open('src/App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print('done')
