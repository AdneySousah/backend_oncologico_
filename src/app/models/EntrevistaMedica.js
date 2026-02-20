import Sequelize, { Model } from "sequelize"

class EntrevistaMedica extends Model {
    static init(sequelize) {
        super.init({
            estadiamento: Sequelize.ENUM('I', 'II', 'III', 'IV'),
            data_contato: Sequelize.DATEONLY,
            observacoes: Sequelize.TEXT,
            data_proximo_contato: Sequelize.DATEONLY,
            turno_contato: Sequelize.ENUM('Manhã', 'Tarde', 'Noite'),

        }, {
            sequelize,
            tableName: 'entrevista_profissional',
        })
        return this
    }

    static associate(models) {
        this.belongsTo(models.Diagnostico, { foreignKey: 'diagnostico_id', as: 'diagnostico_cid' });
        this.belongsTo(models.PrestadorMedico, { foreignKey: 'prestador_medico_id', as: 'prestador_medico' });
        this.belongsTo(models.Exames, { foreignKey: 'exame_id', as: 'exames' });
        this.belongsTo(models.InfosComorbidade, { foreignKey: 'infos_comorbidades_id', as: 'infos_comorbidade' });
        this.belongsTo(models.Pacientes, { foreignKey: 'paciente_id', as: 'paciente' });
        this.belongsTo(models.Medico, { foreignKey: 'medico_id', as: 'medico' });
        
        // RELAÇÃO ANTIGA REMOVIDA
        // this.belongsTo(models.InfosMedicamento, { foreignKey: 'infos_medicamentos_id', as: 'infos_medicamento' });

        // NOVA RELAÇÃO MUITOS-PARA-MUITOS (N:M)
        this.belongsToMany(models.Medicamentos, { 
            through: models.EntrevistaMedicamento, // A tabela/model intermediário
            foreignKey: 'entrevista_profissional_id', // A chave desta tabela lá
            otherKey: 'medicamento_id', // A chave da outra tabela lá
            as: 'medicamentos' // Como vamos chamar no Controller (include: 'medicamentos')
        });

        this.hasMany(models.EntrevistaMedicaAnexos, {
            foreignKey: 'entrevista_profissional_id',
            as: 'anexos'
        });

        this.hasMany(models.PatientEvaluation, {
            foreignKey: 'entrevista_profissional_id',
            as: 'avaliacoes'
        });
    }
}

export default EntrevistaMedica;