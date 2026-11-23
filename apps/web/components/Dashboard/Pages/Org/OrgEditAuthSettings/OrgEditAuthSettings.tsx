'use client'
import React, { useEffect, useState } from 'react'
import { useOrg } from '@components/Contexts/OrgContext'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { toast } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { Shield, KeyRound, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { Button } from '@components/ui/button'
import { Input } from '@components/ui/input'
import { Label } from '@components/ui/label'
import { Switch } from '@components/ui/switch'
import {
  OIDCProviderConfigRead,
  OIDCProviderConfigWrite,
  OIDCConnectionTestResult,
  getOIDCConfig,
  saveOIDCConfig,
  deleteOIDCConfig,
  testOIDCConnection,
} from '@services/auth/oidcAdmin'

/**
 * Administração do login corporativo via OIDC (feature 004). Núcleo AGPL —
 * sem FeatureGate. O segredo é write-only: quando já configurado, o campo
 * mostra "segredo configurado" e a única ação é substituir.
 */
const OrgEditAuthSettings = () => {
  const { t } = useTranslation()
  const org = useOrg() as any
  const session = useLHSession() as any
  const accessToken = session?.data?.tokens?.access_token

  const [config, setConfig] = useState<OIDCProviderConfigRead | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<OIDCConnectionTestResult | null>(null)

  // Campos do formulário
  const [issuerUrl, setIssuerUrl] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [rotateSecret, setRotateSecret] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [autoProvision, setAutoProvision] = useState(false)
  const [allowedDomains, setAllowedDomains] = useState('')
  const [defaultRoleId, setDefaultRoleId] = useState('')
  const [clockSkew, setClockSkew] = useState('60')

  const secretConfigured = config?.secret_configured ?? false

  function hydrate(c: OIDCProviderConfigRead | null) {
    setConfig(c)
    setIssuerUrl(c?.issuer_url ?? '')
    setClientId(c?.client_id ?? '')
    setEnabled(c?.enabled ?? false)
    setAutoProvision(c?.auto_provision_users ?? false)
    setAllowedDomains((c?.allowed_email_domains ?? []).join(', '))
    setDefaultRoleId(c?.default_role_id ? String(c.default_role_id) : '')
    setClockSkew(String(c?.clock_skew_seconds ?? 60))
    setClientSecret('')
    setRotateSecret(false)
  }

  useEffect(() => {
    if (!org?.id || !accessToken) return
    setLoading(true)
    getOIDCConfig(org.id, accessToken)
      .then(hydrate)
      .catch((e) => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [org?.id, accessToken])

  function buildPayload(): OIDCProviderConfigWrite {
    const domains = allowedDomains
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
    const payload: OIDCProviderConfigWrite = {
      issuer_url: issuerUrl.trim(),
      client_id: clientId.trim(),
      enabled,
      auto_provision_users: autoProvision,
      allowed_email_domains: domains,
      default_role_id: defaultRoleId ? Number(defaultRoleId) : null,
      clock_skew_seconds: Number(clockSkew) || 60,
    }
    // Segredo só vai quando é criação ou rotação explícita (write-only).
    if (!secretConfigured || rotateSecret) {
      if (clientSecret) payload.client_secret = clientSecret
    }
    return payload
  }

  async function handleSave() {
    setSaving(true)
    try {
      const saved = await saveOIDCConfig(org.id, buildPayload(), accessToken)
      hydrate(saved)
      toast.success(t('dashboard.organization.auth.saved', { defaultValue: 'Configuração salva.' }))
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await testOIDCConnection(org.id, accessToken, issuerUrl.trim() || undefined)
      setTestResult(result)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setTesting(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('dashboard.organization.auth.confirm_delete', {
      defaultValue: 'Excluir a configuração de login corporativo? Contas e vínculos são preservados.',
    }))) return
    try {
      await deleteOIDCConfig(org.id, accessToken)
      hydrate(null)
      toast.success(t('dashboard.organization.auth.deleted', { defaultValue: 'Configuração excluída.' }))
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-10 text-gray-400">
        <Loader2 className="animate-spin" size={18} /> {t('common.loading', { defaultValue: 'Carregando…' })}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Shield size={20} />
        <h2 className="text-xl font-bold">
          {t('dashboard.organization.auth.title', { defaultValue: 'Login corporativo (OIDC)' })}
        </h2>
      </div>
      <p className="text-sm text-gray-500">
        {t('dashboard.organization.auth.subtitle', {
          defaultValue:
            'Configure um provedor de identidade corporativo (ex.: Keycloak) para permitir login com identidade corporativa.',
        })}
      </p>

      <div className="space-y-4">
        <div>
          <Label>{t('dashboard.organization.auth.issuer', { defaultValue: 'Endereço do emissor (issuer)' })}</Label>
          <Input
            value={issuerUrl}
            onChange={(e) => setIssuerUrl(e.target.value)}
            placeholder="https://kc.exemplo.com/realms/plataforma"
          />
        </div>

        <div>
          <Label>{t('dashboard.organization.auth.client_id', { defaultValue: 'Identificador do cliente' })}</Label>
          <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="learnhouse-web" />
        </div>

        <div>
          <Label>{t('dashboard.organization.auth.client_secret', { defaultValue: 'Segredo do cliente' })}</Label>
          {secretConfigured && !rotateSecret ? (
            <div className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2">
              <span className="flex items-center gap-2 text-sm text-gray-600">
                <KeyRound size={14} /> {t('dashboard.organization.auth.secret_configured', { defaultValue: 'Segredo configurado' })}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => setRotateSecret(true)}>
                {t('dashboard.organization.auth.replace_secret', { defaultValue: 'Substituir' })}
              </Button>
            </div>
          ) : (
            <Input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          )}
        </div>

        <div className="flex items-center justify-between">
          <Label>{t('dashboard.organization.auth.enabled', { defaultValue: 'Login corporativo ativo' })}</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        <div className="border-t border-neutral-100 pt-4 space-y-4">
          <h3 className="text-sm font-semibold text-gray-700">
            {t('dashboard.organization.auth.provisioning', { defaultValue: 'Provisionamento' })}
          </h3>
          <div className="flex items-center justify-between">
            <Label>{t('dashboard.organization.auth.auto_provision', { defaultValue: 'Criar contas automaticamente no primeiro acesso' })}</Label>
            <Switch checked={autoProvision} onCheckedChange={setAutoProvision} />
          </div>
          <div>
            <Label>{t('dashboard.organization.auth.allowed_domains', { defaultValue: 'Domínios de e-mail permitidos (separados por vírgula)' })}</Label>
            <Input value={allowedDomains} onChange={(e) => setAllowedDomains(e.target.value)} placeholder="acme.com, acme.dev" />
          </div>
          <div>
            <Label>{t('dashboard.organization.auth.default_role', { defaultValue: 'ID do papel padrão (menor privilégio)' })}</Label>
            <Input value={defaultRoleId} onChange={(e) => setDefaultRoleId(e.target.value)} placeholder="4" inputMode="numeric" />
          </div>
          <div>
            <Label>{t('dashboard.organization.auth.clock_skew', { defaultValue: 'Tolerância de relógio (segundos, 0–300)' })}</Label>
            <Input value={clockSkew} onChange={(e) => setClockSkew(e.target.value)} inputMode="numeric" />
          </div>
        </div>
      </div>

      {testResult && (
        <div
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
            testResult.status === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {testResult.status === 'ok' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{testResult.detail}</span>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('common.saving', { defaultValue: 'Salvando…' }) : t('common.save', { defaultValue: 'Salvar' })}
        </Button>
        <Button type="button" variant="outline" onClick={handleTest} disabled={testing}>
          {testing
            ? t('dashboard.organization.auth.testing', { defaultValue: 'Testando…' })
            : t('dashboard.organization.auth.test_connection', { defaultValue: 'Testar conexão' })}
        </Button>
        {config && (
          <Button type="button" variant="outline" className="ml-auto text-red-600" onClick={handleDelete}>
            {t('common.delete', { defaultValue: 'Excluir' })}
          </Button>
        )}
      </div>
    </div>
  )
}

export default OrgEditAuthSettings
