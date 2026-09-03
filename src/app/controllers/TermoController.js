import Pacientes from '../models/Pacientes.js';
import Operadora from '../models/Operadora.js';
import VersaoTermo from '../models/VersaoTermo.js';
import User from '../models/User.js';
import { enviarMensagemWhatsApp } from '../../services/whatsapp.js';
import AuditService from '../../services/AuditService.js';
import { gerarPdfTermoNavegacao } from '../../utils/gerarTermoPdf.js';
import TermosHistorico from '../models/TermosHistorico.js';
import Mail from '../../services/Mail.js';

class TermoController {


    async sendLink(req, res) {
        const { paciente_id, telefone_destino, destino_tipo, email_destino } = req.body;

        try {
            const user = await User.findByPk(req.userId);
            const paciente = await Pacientes.findByPk(paciente_id, {
                include: ['operadoras']
            });

            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            if (paciente.tratamento_pausado) {
                return res.status(400).json({ error: 'Este paciente está com o tratamento pausado. Retome o tratamento antes de enviar o termo.' });
            }

            const frontUrl = process.env.FRONT_URL || 'http://localhost:3000';
            const linkAcompanhamento = `${frontUrl}/paciente/termo/${paciente.id}`;

            // ==========================================
            // FLUXO DE DISPARO POR E-MAIL
            // ==========================================
            if (destino_tipo === 'email') {
                if (!email_destino) {
                    return res.status(400).json({ error: 'E-mail não informado.' });
                }

                // Atualiza o e-mail no cadastro se for diferente do atual
                if (paciente.email !== email_destino) {
                    paciente.email = email_destino;
                }
                
                paciente.status_termo = 'Pendente';
                await paciente.save();

                const operadoraNome = paciente.operadoras?.nome || 'nossa equipe de saúde';
                
                const htmlContent = `
                    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.6;">
                        <h2>Olá, ${paciente.nome}!</h2>
                        <p>Meu nome é ${user.name} e estou entrando em contato em nome da <strong>${operadoraNome}</strong>.</p>
                        <p>Precisamos que você leia e aceite os termos de contato para podermos te acompanhar durante o seu tratamento.</p>
                        <p>Por favor, acesse o link abaixo para visualizar e responder ao termo:</p>
                        <div style="margin: 20px 0;">
                            <a href="${linkAcompanhamento}" style="background-color: #0056b3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                                Acessar Termo de Acompanhamento
                            </a>
                        </div>
                        <p>Se o botão não funcionar, copie e cole este link no seu navegador:</p>
                        <p><a href="${linkAcompanhamento}">${linkAcompanhamento}</a></p>
                        <p>Agradecemos a sua atenção!</p>
                    </div>
                `;

                await Mail.sendMail({
                    to: email_destino,
                    subject: 'Termos de Acompanhamento',
                    html: htmlContent
                });

                await AuditService.log(
                    req.userId,
                    'Envio',
                    'Termo E-mail',
                    paciente.id,
                    `Disparou o termo de acompanhamento por e-mail para ${email_destino}.`
                );

                return res.json({ message: 'Link enviado por e-mail com sucesso!' });
            }

            // ==========================================
            // FLUXO: GERAR LINK PRA COPIAR (envio 100% manual, sem
            // disparar nada automaticamente — nem WhatsApp, nem e-mail).
            // Antes esse caso não era tratado aqui e caía, por engano, no
            // bloco de disparo via WhatsApp abaixo — disparando de verdade.
            // ==========================================
            if (destino_tipo === 'copiar_link') {
                paciente.status_termo = 'Pendente';
                await paciente.save();

                await AuditService.log(
                    req.userId,
                    'Envio',
                    'Termo Link Manual',
                    paciente.id,
                    `Gerou o link do termo de acompanhamento para envio manual (nenhum disparo automático foi feito).`
                );

                return res.json({ message: 'Link gerado com sucesso!', link: linkAcompanhamento });
            }

            // ==========================================
            // FLUXO DE DISPARO VIA WHATSAPP (Twilio)
            // ==========================================
            const numeroDestino = telefone_destino || paciente.celular || paciente.telefone;

            if (!numeroDestino) {
                return res.status(400).json({ error: 'Nenhum número de destino informado ou cadastrado.' });
            }

            // Validação estrita: DDD e Dígito 9
            let numeroLimpo = String(numeroDestino).replace(/\D/g, '');
            
            if (numeroLimpo.startsWith('55') && numeroLimpo.length >= 13) {
                numeroLimpo = numeroLimpo.substring(2);
            }

            if (numeroLimpo.length !== 11 || numeroLimpo[2] !== '9') {
                return res.status(400).json({ 
                    error: 'Número inválido para envio. O número deve conter o DDD e o dígito 9. Ex: (31) 98888-8888' 
                });
            }

            paciente.status_termo = 'Pendente';
            await paciente.save();

            const enviado = await enviarMensagemWhatsApp(
                numeroDestino,
                paciente.nome,
                paciente.operadoras?.nome || 'sua operadora',
                user.name,
                linkAcompanhamento,
                req.userId
            );

            if (!enviado) {
                return res.status(500).json({ error: 'Falha ao enviar mensagem via WhatsApp' });
            }

            let nomeDestinoFinal = paciente.nome;
            let papelDestino = 'Paciente';

            if (destino_tipo === 'cuidador') {
                nomeDestinoFinal = paciente.nome_cuidador || 'Não informado';
                papelDestino = 'Cuidador/Responsável';
            } else if (destino_tipo === 'manual') {
                nomeDestinoFinal = 'Número inserido manualmente pelo operador';
                papelDestino = 'Contato Manual/Avulso';
            }

            const mensagemLog = `Disparou o termo de acompanhamento para o(a) ${papelDestino} (${nomeDestinoFinal}) no número ${numeroDestino}.`;

            await AuditService.log(
                req.userId,
                'Envio',
                'Termo WhatsApp',
                paciente.id,
                mensagemLog
            );

            return res.json({ message: 'Link enviado com sucesso!' });

        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro interno no servidor' });
        }
    }

    // Acessado publicamente pelo paciente clicando no link

    async answerTerm(req, res) {
    const { id } = req.params;
    const { aceite } = req.body; // boolean

    try {
        const paciente = await Pacientes.findByPk(id);

        if (!paciente) {
            return res.status(404).json({ error: 'Paciente não encontrado' });
        }

        // Atualiza os dados principais
        paciente.status_termo = aceite ? 'Aceito' : 'Recusado';

        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'];

        if (aceite) {
            // 👇 Não gera nem salva PDF nenhum aqui — o termo é padrão (só
            // muda nome/CPF/operadora do paciente), então é reconstruído ao
            // vivo sempre que alguém precisar visualizar (rota /preview-pdf),
            // em vez de guardar uma cópia física ocupando espaço.
            // Vincula a VERSÃO do texto vigente agora — se o texto for
            // editado no futuro (nova versão), esse paciente continua
            // vinculado ao que ele realmente aceitou.
            const versaoAtiva = await VersaoTermo.findOne({ where: { ativo: true }, order: [['id', 'DESC']] });

            paciente.termo_data_aceite = new Date();
            paciente.termo_ip = ip;
            paciente.termo_user_agent = userAgent;
            paciente.termo_versao_id = versaoAtiva ? versaoAtiva.id : null;
        } else {
            paciente.termo_data_aceite = null;
            paciente.termo_ip = null;
            paciente.termo_user_agent = null;
            paciente.termo_versao_id = null;
        }

        await paciente.save();

        // Salva o registro imutável na tabela de histórico (auditoria de
        // quando/como o aceite aconteceu — sem referência a arquivo, já que
        // não existe mais arquivo físico).
        await TermosHistorico.create({
            paciente_id: paciente.id,
            status: paciente.status_termo,
            arquivo_path: null,
            ip: ip,
            user_agent: userAgent
        });

        return res.json({ 
            message: 'Resposta registrada com sucesso', 
            status_termo: paciente.status_termo,
            termo_data_aceite: paciente.termo_data_aceite
        });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Erro ao processar resposta' });
    }
}

    async verifyResponse(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, {
                include: ['operadoras'],
                // ✅ NOVO: Adicionado 'termo_data_aceite' nos atributos retornados
                attributes: ['id', 'status_termo', 'termo_data_aceite'] 
            });
            
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            
            return res.json({ paciente });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    // Método para o frontend consultar o status em tempo real (Polling)
    async checkStatus(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, { attributes: ['id', 'status_termo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ status_termo: paciente.status_termo });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    async verifyResponse(req, res) {
        const { id } = req.params
        try {
            const paciente = await Pacientes.findByPk(id,
                {
                    include: ['operadoras'],
                    attributes: ['id', 'status_termo']
                }
            );
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }
            return res.json({ paciente });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao checar status' });
        }
    }

    async previewPdf(req, res) {
        const { id } = req.params;
        try {
            const paciente = await Pacientes.findByPk(id, { include: ['operadoras', 'versaoTermo'] });
            if (!paciente) {
                return res.status(404).json({ error: 'Paciente não encontrado' });
            }

            const operadoraNome = paciente.operadoras?.nome || 'sua operadora';

            // Se o paciente já aceitou antes, mostra a versão que ELE viu
            // (fidelidade histórica). Se ainda não aceitou (preview antes de
            // decidir), mostra a versão vigente agora.
            const versao = paciente.versaoTermo || await VersaoTermo.findOne({ where: { ativo: true }, order: [['id', 'DESC']] });

            if (!versao) {
                return res.status(500).json({ error: 'Nenhuma versão do termo está cadastrada no sistema.' });
            }

            // Passa o "res" para a função. Ela vai gerar e enviar direto para o navegador
            await gerarPdfTermoNavegacao(paciente, res, operadoraNome, versao);
        } catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao gerar visualização do termo' });
        }
    }

    // Lista todo paciente com termo aceito — antes essa listagem dependia de
    // um arquivo salvo em PacienteTermoAnexo; agora usa direto o cadastro do
    // paciente (fonte real da verdade) e o PDF é gerado ao vivo quando
    // alguém clicar em "Visualizar/Baixar" (rota /preview-pdf), sem precisar
    // de nenhum arquivo armazenado.
    async listarTermosAceitos(req, res) {
        try {
            const pacientes = await Pacientes.findAll({
                where: { status_termo: 'Aceito' },
                attributes: ['id', 'nome', 'sobrenome', 'cpf', 'termo_data_aceite'],
                include: [
                    { model: Operadora, as: 'operadoras', attributes: ['id', 'nome'] },
                    { model: VersaoTermo, as: 'versaoTermo', attributes: ['id', 'titulo'] }
                ],
                order: [['termo_data_aceite', 'DESC']]
            });

            return res.json(pacientes);
        } catch (error) {
            console.error('Erro ao listar termos aceitos:', error);
            return res.status(500).json({ error: 'Erro ao listar termos aceitos.' });
        }
    }

    // Lista o histórico de versões do termo (mais recente primeiro).
    async listarVersoesTermo(req, res) {
        try {
            const versoes = await VersaoTermo.findAll({
                include: [{ model: User, as: 'criador', attributes: ['id', 'name'] }],
                order: [['id', 'DESC']]
            });
            return res.json(versoes);
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao listar versões do termo.' });
        }
    }

    // Cria uma nova versão do termo e a torna a ativa — a antiga continua
    // existindo (histórico), só deixa de ser usada em novos aceites.
    // Pacientes que já aceitaram sob a versão anterior continuam vinculados
    // a ela, sem nenhuma alteração retroativa.
    async criarVersaoTermo(req, res) {
        const { titulo, introducao, textoAutorizacao, finalidades, textoCiente, itensCiente } = req.body;

        if (!introducao || !Array.isArray(finalidades) || !Array.isArray(itensCiente)) {
            return res.status(400).json({ error: 'Preencha ao menos a introdução e as duas listas (finalidades e itens de ciência).' });
        }

        try {
            await VersaoTermo.update({ ativo: false }, { where: { ativo: true } });

            const novaVersao = await VersaoTermo.create({
                titulo: titulo || 'TERMO DE ACEITE PARA NAVEGAÇÃO E CONTATO VIA WHATSAPP',
                conteudo: { introducao, textoAutorizacao, finalidades, textoCiente, itensCiente },
                ativo: true,
                criado_por: req.userId
            });

            await AuditService.log(req.userId, 'Criação', 'Versão do Termo', novaVersao.id, `Nova versão do termo criada e ativada (versão #${novaVersao.id}). Versões anteriores continuam vinculadas aos pacientes que já aceitaram sob elas.`);

            return res.status(201).json(novaVersao);
        } catch (error) {
            console.error('Erro ao criar versão do termo:', error);
            return res.status(500).json({ error: 'Erro ao criar nova versão do termo.' });
        }
    }
}

export default new TermoController();