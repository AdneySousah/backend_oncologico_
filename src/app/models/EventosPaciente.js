import Sequelize, { Model } from 'sequelize';

class EventosPaciente extends Model {
    static init(sequelize) {
        super.init({
            external_id: Sequelize.INTEGER,
            data_entrega_prevista: Sequelize.DATEONLY,
            data_administracao_prevista: Sequelize.DATEONLY,
            qtd_caixas: Sequelize.INTEGER,
            preco: Sequelize.NUMERIC,
            recebido: Sequelize.BOOLEAN,
            data_entrega_real: Sequelize.DATEONLY,

            // 👇 NOVO: rastreio de processamento pelo telemonitoramento (ver
            // migration add-processamento-to-eventos-pacientes). Antes, o único
            // vínculo era monitoramento_medicamentos.evento_externo_id, que não
            // dizia QUANDO nem POR QUEM o evento foi consumido.
            processado: Sequelize.BOOLEAN,
            processado_em: Sequelize.DATE,
            processado_por_id: Sequelize.INTEGER,
            monitoramento_id: Sequelize.INTEGER,
            // CICLO = gerou um ciclo; CONSUMIDO_SEM_CICLO = medicamento usado,
            // mas pulado ao aplicar uma compra mais recente.
            tipo_processamento: Sequelize.ENUM('CICLO', 'CONSUMIDO_SEM_CICLO'),
            processamento_observacao: Sequelize.TEXT
        }, {
            sequelize,
            tableName: 'eventos_pacientes',
        });
        return this;
    }

    static associate(models) {
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
        this.belongsTo(models.Medicamentos, { foreignKey: 'medicamento_id', as: 'medicamento' });
        this.belongsTo(models.User, { foreignKey: 'processado_por_id', as: 'processadoPor' });
        this.belongsTo(models.MonitoramentoMedicamento, { foreignKey: 'monitoramento_id', as: 'monitoramento' });
    }
}

export default EventosPaciente;