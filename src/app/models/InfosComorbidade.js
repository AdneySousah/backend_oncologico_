import { Model, Sequelize } from "sequelize";



class InfosComorbidade extends Model {
    static init(sequelize){
        super.init({
            possui_comorbidade: Sequelize.BOOLEAN,
            sabe_diagnostico: Sequelize.BOOLEAN,
            descricao_diagnostico: Sequelize.STRING
        }, {
            sequelize,
            tableName: 'infos_comorbidade'
        });
        return this
    }

    static associate(models) {
        // Associação com o cadastro mestre de comorbidades
        this.belongsTo(models.Comorbidades, { foreignKey: 'comorbidade_id', as: 'comorbidade_mestre' });
    }
}


export default InfosComorbidade;