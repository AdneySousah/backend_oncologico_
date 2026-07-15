import Pacientes from '../app/models/Pacientes.js';
import Operadora from '../app/models/Operadora.js';
import Medicamentos from '../app/models/Medicamentos.js';
import EventosPaciente from '../app/models/EventosPaciente.js';
import AuditService from './AuditService.js';

const formatarCelularWhatsapp = (numero) => {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, '');
    if (limpo.length === 11 && !limpo.startsWith('55')) limpo = '55' + limpo;
    return limpo;
};

// Nova função para garantir que o corte da data respeite o fuso do Brasil (-03:00)
const extrairDataBrasil = (dataIso) => {
    if (!dataIso) return null;

    // Se a data já vier curta (ex: 2026-06-30), retorna direto
    if (dataIso.length === 10) return dataIso;

    try {
        // Se a data vier no formato ISO longo (ex: 2026-06-30T03:00:00.000Z)
        // Cortamos no 'T' e pegamos apenas a parte da data.
        if (dataIso.includes('T')) {
            return dataIso.split('T')[0];
        }

        // Se vier com espaço separando hora (ex: 2026-06-30 00:00:00)
        if (dataIso.includes(' ')) {
            return dataIso.split(' ')[0];
        }

        // Fallback cortando os 10 primeiros caracteres (YYYY-MM-DD)
        return String(dataIso).substring(0, 10);
    } catch (error) {
        return null;
    }
};

class PacienteSyncService {
    async syncPacientes(pacientesExternos, userId) {
        const successes = [];
        const errors = [];

        for (const extPatient of pacientesExternos) {
            try {
                // ============================================================
                // FILTRO DE NAVEGAÇÃO ONCOLÓGICA EXCLUSIVA (RIGOROSO)
                // ============================================================
                const hasTreatmentType4 = extPatient.treatmentTypes &&
                    Array.isArray(extPatient.treatmentTypes) &&
                    extPatient.treatmentTypes.some(t => String(t.id) === '4');

                // Pega TODOS os eventos válidos (não apenas o primeiro)
                const eventosValidos = extPatient.events && Array.isArray(extPatient.events)
                    ? extPatient.events.filter(e =>
                        String(e.eventtype_id) === '2' &&
                        String(e.medicament_received) === '1' &&
                        e.medicament &&
                        String(e.medicament.treatment_types_id) === '4'
                    )
                    : [];

                const isFundacaoLibertas = extPatient.company &&
                    extPatient.company.name &&
                    String(extPatient.company.name).trim().toUpperCase() === 'FUNDAÇÃO LIBERTAS';

                if (!hasTreatmentType4 || eventosValidos.length === 0 || isFundacaoLibertas) {
                    console.log(`[SYNC] Ignorado: ${extPatient.name} (Motivo: Filtro não atendido ou operadora bloqueada)`);
                    continue;
                }

                console.log(`[SYNC] ⏳ Processando paciente: ${extPatient.name}...`);

                // ==========================================
                // PASSO 1: SINCRONIZAR A OPERADORA
                // ==========================================
                let operadora = null;
                if (extPatient.company) {
                    const nameOperadora = extPatient.company.name === 'CLÍNICA DE INFUSÃO COMPARTILHADA'
                        ? 'CICFARMA'
                        : extPatient.company.name;

                    if (extPatient.company.id !== undefined && extPatient.company.id !== null) {
                        operadora = await Operadora.findOne({ where: { external_id: extPatient.company.id } });
                    }

                    if (operadora && nameOperadora) {
                        await operadora.update({ nome: nameOperadora });
                    } else if (!operadora && nameOperadora) {
                        operadora = await Operadora.findOne({ where: { nome: nameOperadora } });
                        if (operadora) {
                            await operadora.update({ external_id: extPatient.company.id || null });
                        } else {
                            operadora = await Operadora.create({
                                external_id: extPatient.company.id || null,
                                nome: nameOperadora,
                                cnpj: '00000000000000',
                                telefone: '00000000000',
                                email: [],
                                is_active: true
                            });
                        }
                    }
                }

                // ==========================================
                // PASSO 2: PREPARAR OS DADOS DO PACIENTE
                // ==========================================
                const partesNome = extPatient.name ? extPatient.name.trim().split(' ') : ['Sem', 'Nome'];
                const primeiroNome = partesNome.shift();
                const restoSobrenome = partesNome.join(' ');
                const cpfLimpo = extPatient.cpf ? String(extPatient.cpf).replace(/\D/g, '') : null;

                const dadosPaciente = {
                    external_id: extPatient.id || null,
                    matricula: extPatient.matriculation || null,
                    nome: primeiroNome.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    sobrenome: restoSobrenome.toLowerCase().replace(/\b\w/g, l => l.toUpperCase()),
                    cpf: cpfLimpo,
                    data_nascimento: extPatient.dateage || null,
                    sexo: extPatient.gender || 'nao definido',
                    celular: formatarCelularWhatsapp(extPatient.cellphone || extPatient.phone),
                    telefone: String(extPatient.phone || '').replace(/\D/g, ''),
                    cep: String(extPatient.zipcode || '').replace(/\D/g, ''),
                    logradouro: extPatient.address || 'N/A',
                    numero: extPatient.number || 'S/N',
                    complemento: extPatient.complement ? extPatient.complement.trim() : null,
                    bairro: extPatient.district || 'N/A',
                    cidade: extPatient.city || 'N/A',
                    estado: extPatient.state || 'N/A',
                    possui_cuidador: !!extPatient.responsible,
                    nome_cuidador: extPatient.responsible || null,
                    contato_cuidador: extPatient.phone_responsible ? formatarCelularWhatsapp(extPatient.phone_responsible) : null,
                    operadora_id: operadora ? operadora.id : null,
                    is_active: String(extPatient.status) === '0',
                    is_new_user: true
                };

                let paciente = null;
                if (dadosPaciente.external_id) {
                    paciente = await Pacientes.findOne({ where: { external_id: dadosPaciente.external_id } });
                }
                if (!paciente && dadosPaciente.cpf) {
                    paciente = await Pacientes.findOne({ where: { cpf: dadosPaciente.cpf } });
                }

                if (paciente) {
                    await paciente.update(dadosPaciente);
                    await AuditService.log(userId, 'Edição', 'Pacientes', paciente.id, `Paciente ${dadosPaciente.nome} ${dadosPaciente.sobrenome} atualizado via sincronização.`);
                } else {
                    paciente = await Pacientes.create(dadosPaciente);
                    await AuditService.log(userId, 'Criação', 'Pacientes', null, `Paciente ${dadosPaciente.nome} ${dadosPaciente.sobrenome} criado via sincronização.`);
                }

                // ==========================================
                // PASSO 3: SINCRONIZAR O HISTÓRICO DE EVENTOS
                // ==========================================
                for (const extEvent of eventosValidos) {
                    let extMed = extEvent.medicament;
                    let medicamentoEventoId = null;

                    if (extMed) {
                        let medicamento = null;
                        if (extMed.id) medicamento = await Medicamentos.findOne({ where: { external_id: extMed.id } });
                        if (!medicamento && extMed.tusscode) medicamento = await Medicamentos.findOne({ where: { codigo_tuss: extMed.tusscode } });

                        let tipoDosagemFormatado = extMed.measurement ? String(extMed.measurement).toUpperCase().trim() : null;
                        const dosagensPermitidas = ['MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML'];
                        if (tipoDosagemFormatado && !dosagensPermitidas.includes(tipoDosagemFormatado)) tipoDosagemFormatado = null;

                        let qtdCapsulaExtraida = null;
                        if (extMed.dosage) {
                            const apenasNumeros = String(extMed.dosage).replace(/\D/g, '');
                            if (apenasNumeros) qtdCapsulaExtraida = parseInt(apenasNumeros, 10);
                        }

                        const medData = {
                            external_id: extMed.id || null,
                            codigo_tuss: extMed.tusscode || null,
                            nome: extMed.name,
                            nome_comercial: extMed.commercial_name,
                            principio_ativo: extMed.active_principle,
                            qtd_capsula: qtdCapsulaExtraida,
                            dosagem: extMed.dosage ? String(extMed.dosage).trim() : null,
                            tipo_dosagem: tipoDosagemFormatado,
                            apresentacao: extMed.apresentation,
                            via_administracao: extMed.way_administration,
                            tipo_matmed: extMed.typematmed,
                            tipo_medicamento: extMed.type_medicament,
                            price: extEvent.price ? parseFloat(extEvent.price) : null,
                            fornecedor: extEvent.prices && extEvent.prices.company ? extEvent.prices.company.name : null
                        };

                        if (medicamento) {
                            await medicamento.update(medData);
                        } else {
                            medicamento = await Medicamentos.create(medData);
                        }
                        medicamentoEventoId = medicamento.id;
                    }

                    // Upsert do Evento - Aplicando a correção de fuso horário
                    const eventoData = {
                        external_id: extEvent.id,
                        paciente_id: paciente.id,
                        medicamento_id: medicamentoEventoId,

                        // CORREÇÃO APLICADA AQUI 👇
                        data_entrega_prevista: extrairDataBrasil(extEvent.date_delivery),
                        data_entrega_real: extrairDataBrasil(extEvent.medicament_received_date),
                        data_administracao_prevista: extrairDataBrasil(extEvent.administration_date_prev),

                        qtd_caixas: extEvent.qtd_medicament ? parseInt(extEvent.qtd_medicament, 10) : 1,
                        preco: extEvent.price ? parseFloat(extEvent.price) : null,
                        recebido: true
                    };

                    const eventoExistente = await EventosPaciente.findOne({ where: { external_id: extEvent.id } });
                    if (eventoExistente) {
                        await eventoExistente.update(eventoData);
                    } else {
                        await EventosPaciente.create(eventoData);
                    }
                }

                successes.push({ nome: extPatient.name, cpf: extPatient.cpf });
            } catch (err) {
                console.error(`Erro ao sincronizar paciente ${extPatient.name}:`, err.message);
                errors.push({ nome: extPatient.name, cpf: extPatient.cpf, erro: err.message });
            }
        }

        return { successes, errors };
    }
}

export default new PacienteSyncService();