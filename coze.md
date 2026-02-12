curl -X POST 'https://api.coze.cn/v3/chat?conversation_id=7605921450529390632&' \
-H "Authorization: Bearer sat_dn6nQ6mVUxadTTT6HPnEaGBFwkRyvslKxRrxYvXCDgjzJ09bECdS4HH604r92ZDV" \
-H "Content-Type: application/json" \
-d '{
  "user_id": "hao",
  "stream": true,
  "bot_id": "7605916786898829346",
  "additional_messages": [
    {
      "role": "user",
      "type": "question",
      "content_type": "text",
      "content": "郝玉锋是谁"
    }
  ]
}'


