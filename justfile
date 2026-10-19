set dotenv-load

# Create the Access policy and application that guard the Worker, then store the app's AUD in .env
access:
    #!/usr/bin/env bash
    set -euo pipefail
    : "${CLOUDFLARE_ACCOUNT_ID:?set it in .env}" "${ACCESS_API_TOKEN:?set it in .env or the environment}"
    : "${CLAIRIC_DOMAIN:?set it in .env}" "${ACCESS_EMAILS:?set it in .env}"
    if [ -n "${ACCESS_AUD:-}" ]; then
        echo "ACCESS_AUD is already set in .env, so the Access application exists. Clear it to create another." >&2
        exit 1
    fi
    api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/access"
    post() {
        local reply
        if ! reply=$(curl -sS --fail-with-body -X POST "$api/$1" \
            -H "Authorization: Bearer $ACCESS_API_TOKEN" -H "Content-Type: application/json" --data "$2"); then
            echo "POST $1 failed: $reply" >&2
            return 1
        fi
        echo "$reply"
    }
    policy_body=$(jq -cn --arg emails "$ACCESS_EMAILS" '{
        name: "clairic-mcp users",
        decision: "allow",
        include: ($emails | split(",") | map(gsub("^\\s+|\\s+$"; "")) | map(select(. != "")) | map({email: {email: .}}))
    }')
    policy=$(post policies "$policy_body" | jq -r .result.id)
    echo "Created Access policy $policy" >&2
    # A policy left without its application would be duplicated by the next run, since ACCESS_AUD stays empty.
    trap 'echo "Deleting Access policy $policy" >&2; curl -sS -o /dev/null -X DELETE "$api/policies/$policy" -H "Authorization: Bearer $ACCESS_API_TOKEN"' ERR
    app_body=$(jq -cn --arg domain "$CLAIRIC_DOMAIN" --arg policy "$policy" --arg idp "${ACCESS_IDP_ID:-}" '{
        name: "clairic-mcp",
        type: "self_hosted",
        domain: $domain,
        destinations: [{type: "public", uri: $domain}],
        policies: [{id: $policy, precedence: 1}],
        session_duration: "24h",
        oauth_configuration: {
            enabled: true,
            grant: {session_duration: "336h", access_token_lifetime: "15m"},
            dynamic_client_registration: {
                enabled: true,
                allowed_uris: ["https://claude.ai/api/mcp/auth_callback"],
                allow_any_on_localhost: true,
                allow_any_on_loopback: true
            }
        }
    } + (if $idp == "" then {} else {allowed_idps: [$idp], auto_redirect_to_identity: true} end)')
    app=$(post apps "$app_body")
    trap - ERR
    echo "Created Access application $(jq -r .result.id <<< "$app") on $CLAIRIC_DOMAIN" >&2
    { grep -v '^ACCESS_AUD=' .env || true; echo "ACCESS_AUD=$(jq -r .result.aud <<< "$app")"; } > .env.next
    mv .env.next .env

# Check, test and deploy the Worker to CLAIRIC_DOMAIN behind the Access application
ci:
    pnpm exec oxfmt --check .
    pnpm exec oxlint
    pnpm exec tsc --noEmit -p .
    pnpm exec vitest run

deploy: ci
    #!/usr/bin/env bash
    set -euo pipefail
    : "${CLAIRIC_DOMAIN:?set it in .env}" "${ACCESS_TEAM_DOMAIN:?set it in .env}" "${ACCESS_AUD:?run just access first}"
    pnpm exec wrangler deploy --domain "$CLAIRIC_DOMAIN" \
        --var "ACCESS_TEAM_DOMAIN:$ACCESS_TEAM_DOMAIN" --var "ACCESS_AUD:$ACCESS_AUD"
