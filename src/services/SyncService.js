import Pacientes from '../app/models/Pacientes.js';
import Operadora from '../app/models/Operadora.js';
import Medicamentos from '../app/models/Medicamentos.js'; 

const formatarCelularWhatsapp = (numero) => {
    if (!numero) return null;
    let limpo = String(numero).replace(/\D/g, '');
    if (limpo.length === 11 && !limpo.startsWith('55')) limpo = '55' + limpo;
    return limpo;
};

class PacienteSyncService {
    
    async syncPacientes(pacientesExternos) {
        const successes = [];
        const errors = [];

        for (const extPatient of pacientesExternos) {
            try {
                // ============================================================
                // FILTRO DE NAVEGAÇÃO ONCOLÓGICA EXCLUSIVA
                // ============================================================
                if (
                    String(extPatient.oncological_navigation) !== '1' ||
                    String(extPatient.immunobiological) === '1' ||
                    String(extPatient.oncological) === '1'
                ) {
                    console.log(`[SYNC] Ignorado: ${extPatient.name} (Não é exclusivo de navegação oncológica)`);
                    continue; 
                }
                
                console.log(`[SYNC] ⏳ Processando paciente: ${extPatient.name}...`);
                
                // ==========================================
                // PASSO 1: SINCRONIZAR A OPERADORA
                // ==========================================
                let operadora = null;
                
                if (extPatient.company) {
                    if (extPatient.company.id !== undefined && extPatient.company.id !== null) {
                        operadora = await Operadora.findOne({ 
                            where: { external_id: extPatient.company.id } 
                        });
                    }

                    if (operadora && extPatient.company.name) {
                        await operadora.update({ nome: extPatient.company.name });
                    } 
                    else if (!operadora && extPatient.company.name) {
                        operadora = await Operadora.findOne({ where: { nome: extPatient.company.name } });
                        
                        if (operadora) {
                            await operadora.update({ external_id: extPatient.company.id || null });
                        } else {
                            operadora = await Operadora.create({
                                external_id: extPatient.company.id || null,
                                nome: extPatient.company.name,
                                cnpj: '00000000000000', 
                                telefone: '00000000000', 
                                email: [], 
                                is_active: true
                            });
                        }
                    }
                }

                // ==========================================
                // PASSO 2: SINCRONIZAR O MEDICAMENTO (via medicament1)
                // ==========================================
                let medicamento_id = null;

                // Agora lemos direto de extPatient.medicament1
                if (extPatient.medicament1) {
                    const extMed = extPatient.medicament1;
                    let medicamento = null;

                    // Tenta achar pelo ID externo primeiro
                    if (extMed.id) {
                        medicamento = await Medicamentos.findOne({ where: { external_id: extMed.id } });
                    }

                    // Se não achar, tenta pelo código TUSS
                    if (!medicamento && extMed.tusscode) {
                        medicamento = await Medicamentos.findOne({ where: { codigo_tuss: extMed.tusscode } });
                    }

                    // Tratar o ENUM de tipo_dosagem
                    let tipoDosagemFormatado = extMed.measurement ? String(extMed.measurement).toUpperCase().trim() : null;
                    const dosagensPermitidas = ['MG', 'G', 'MCG', 'UI', 'ML', 'MG/ML'];
                    if (tipoDosagemFormatado && !dosagensPermitidas.includes(tipoDosagemFormatado)) {
                        tipoDosagemFormatado = null; 
                    }

                    // Extrair quantidade de cápsulas (apenas números) do dosage para o Telemonitoramento
                    let qtdCapsulaExtraida = null;
                    if (extMed.dosage) {
                        const apenasNumeros = String(extMed.dosage).replace(/\D/g, '');
                        if (apenasNumeros) {
                            qtdCapsulaExtraida = parseInt(apenasNumeros, 10);
                        }
                    }

                    const medData = {
                        external_id: extMed.id || null,
                        codigo_tuss: extMed.tusscode || null,
                        nome: extMed.name,
                        nome_comercial: extMed.commercial_name,
                        principio_ativo: extMed.active_principle,
                        qtd_capsula: qtdCapsulaExtraida, // <-- Extraído do dosage
                        dosagem: extMed.dosage ? String(extMed.dosage).trim() : null,
                        tipo_dosagem: tipoDosagemFormatado,
                        apresentacao: extMed.apresentation,
                        via_administracao: extMed.way_administration,
                        tipo_matmed: extMed.typematmed,
                        tipo_medicamento: extMed.type_medicament,
                        price: null // A API não manda preço dentro de medicament1
                    };

                    if (medicamento) {
                        await medicamento.update(medData);
                    } else {
                        medicamento = await Medicamentos.create(medData);
                    }

                    medicamento_id = medicamento.id;
                }

                // ==========================================
                // PASSO 3: PREPARAR OS DADOS DO PACIENTE
                // ==========================================
                const partesNome = extPatient.name ? extPatient.name.trim().split(' ') : ['Sem', 'Nome'];
                const primeiroNome = partesNome.shift();
                const restoSobrenome = partesNome.join(' ');

                const cpfLimpo = extPatient.cpf ? String(extPatient.cpf).replace(/\D/g, '') : null;

                const dadosPaciente = {
                    external_id: extPatient.id || null,
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
                    medicamento_id: medicamento_id, // <-- VÍNCULO DO MEDICAMENTO AQUI
                    is_active: extPatient.status === 0,
                    is_new_user: true 
                };

                // ==========================================
                // PASSO 4: SALVAR NO BANCO LOCAL
                // ==========================================
                let paciente = null;

                if (dadosPaciente.external_id) {
                    paciente = await Pacientes.findOne({ where: { external_id: dadosPaciente.external_id } });
                }

                if (!paciente && dadosPaciente.cpf) {
                    paciente = await Pacientes.findOne({ where: { cpf: dadosPaciente.cpf } });
                }

                if (paciente) {
                    await paciente.update(dadosPaciente);
                } else {
                    await Pacientes.create(dadosPaciente);
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