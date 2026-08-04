"""Teste da marca na renderização de e-mails (feature 005, T030 — Princípio III).

Garante que o placeholder ``{platform_name}`` resolve para o ``site_name`` da
config e que NENHUM literal ``{platform_name}`` sobra na saída — um placeholder
literal chegando ao usuário é exatamente o defeito que este teste impede.
"""

from types import SimpleNamespace
from unittest.mock import Mock, patch

from src.services.email.utils import resolve_platform_name, send_email


def _config(site_name="Notoriun"):
    return SimpleNamespace(
        site_name=site_name,
        mailing_config=SimpleNamespace(
            email_provider="resend",
            system_email_address="no-reply@exemplo.dev",
            resend_api_key="rk",
        ),
    )


class TestResolvePlatformName:
    def test_placeholder_e_resolvido_com_site_name(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config("MinhaMarca"),
        ):
            saida = resolve_platform_name("Bem-vindo à {platform_name}!")

        assert saida == "Bem-vindo à MinhaMarca!"
        assert "{platform_name}" not in saida

    def test_texto_sem_placeholder_passa_intacto(self):
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config(),
        ):
            assert resolve_platform_name("Sem placeholder") == "Sem placeholder"

    def test_multiplas_ocorrencias_todas_resolvidas(self):
        texto = "{platform_name} — entre na {platform_name} agora"
        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config("Marca"),
        ):
            saida = resolve_platform_name(texto)

        assert saida.count("Marca") == 2
        assert "{platform_name}" not in saida


class TestSendEmailBranding:
    def test_remetente_e_corpo_usam_site_name_sem_placeholder_residual(self):
        enviado = {}

        def _fake_send(payload):
            enviado.update(payload)
            return {"id": "1"}

        with patch(
            "src.services.email.utils.get_learnhouse_config",
            return_value=_config("Notoriun"),
        ), patch("src.services.email.utils.resend") as fake_resend:
            fake_resend.Emails.send = Mock(side_effect=_fake_send)

            send_email(
                "aluno@acme.dev",
                "Bem-vindo à {platform_name}",
                "<p>Sua conta na {platform_name} foi criada.</p>",
            )

        assert enviado["from"].startswith("Notoriun <")
        assert enviado["subject"] == "Bem-vindo à Notoriun"
        assert "Notoriun" in enviado["html"]
        # NENHUM literal de placeholder sobra na saída (T030/C1 da análise)
        for campo in ("from", "subject", "html"):
            assert "{platform_name}" not in enviado[campo]
        # E nenhum literal da marca original hardcoded no remetente
        assert "LearnHouse" not in enviado["from"]
